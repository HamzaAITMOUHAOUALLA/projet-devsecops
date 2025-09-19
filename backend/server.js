const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { Octokit } = require('@octokit/rest');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for large payloads

// Configure longer timeouts for network requests
const agent = new https.Agent({
  timeout: 30000,
  keepAlive: true,
  maxSockets: 10,
});

// Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error('❌ GITHUB_TOKEN manquant dans .env');
  process.exit(1);
}

// GitHub API with timeout configuration
const octokit = new Octokit({ 
  auth: GITHUB_TOKEN,
  request: {
    timeout: 30000,
    agent: agent,
  }
});

// Base de données SQLite
const db = new sqlite3.Database('./scanner.db', (err) => {
  if (err) {
    console.error('❌ Erreur base de données:', err);
    process.exit(1);
  }
  console.log('✅ Base de données connectée');
});

// Créer tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      github_url TEXT NOT NULL,
      repository TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      results TEXT,
      error_message TEXT,
      duration INTEGER,
      files_scanned INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS vulnerabilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id TEXT NOT NULL,
      vuln_id TEXT,
      severity TEXT,
      title TEXT,
      description TEXT,
      package_name TEXT,
      version TEXT,
      fixed_version TEXT,
      reference_links TEXT,
      FOREIGN KEY(scan_id) REFERENCES scans(id) ON DELETE CASCADE
    )
  `);
});

// WebSocket
let wsServer;
const clients = new Set();

// Fonctions utilitaires
const broadcastToClients = (data) => {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) {
      try {
        client.send(message);
      } catch (error) {
        clients.delete(client);
      }
    }
  });
};

const updateScanStatus = (scanId, status, additionalData = {}) => {
  return new Promise((resolve, reject) => {
    let query = 'UPDATE scans SET status = ?';
    let params = [status];
    
    if (status === 'completed' || status === 'failed') {
      query += ', completed_at = CURRENT_TIMESTAMP';
    }
    
    if (additionalData.results) {
      query += ', results = ?';
      params.push(JSON.stringify(additionalData.results));
    }
    
    if (additionalData.errorMessage) {
      query += ', error_message = ?';
      params.push(additionalData.errorMessage);
    }
    
    if (additionalData.duration) {
      query += ', duration = ?';
      params.push(additionalData.duration);
    }
    
    if (additionalData.files_scanned) {
      query += ', files_scanned = ?';
      params.push(additionalData.files_scanned);
    }
    
    query += ' WHERE id = ?';
    params.push(scanId);
    
    db.run(query, params, function(err) {
      if (err) {
        reject(err);
      } else {
        // Récupérer le scan mis à jour
        db.get('SELECT * FROM scans WHERE id = ?', [scanId], (err, scan) => {
          if (!err && scan) {
            const scanData = {
              ...scan,
              results: scan.results ? JSON.parse(scan.results) : null
            };
            
            // Notifier via WebSocket
            broadcastToClients({
              type: 'scan_update',
              scan: scanData
            });
            
            resolve(scanData);
          } else {
            resolve({ id: scanId, status });
          }
        });
      }
    });
  });
};

const parseGitHubUrl = (url) => {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) throw new Error('URL GitHub invalide');
  
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
    fullName: `${match[1]}/${match[2].replace(/\.git$/, '')}`
  };
};

// Retry function for GitHub API calls
const retryGitHubCall = async (fn, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`❌ Tentative ${i + 1} échouée:`, error.message);
      
      if (i === retries - 1) {
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      const waitTime = Math.pow(2, i) * 1000; // 1s, 2s, 4s
      console.log(`⏳ Attente ${waitTime}ms avant nouvelle tentative...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
};

// 🚀 ROUTES API

// Déclencher un scan
app.post('/api/scan/trigger', async (req, res) => {
  try {
    const { githubUrl } = req.body;
    
    if (!githubUrl) {
      return res.status(400).json({ error: 'URL GitHub requise' });
    }
    
    // Parser l'URL
    const repoInfo = parseGitHubUrl(githubUrl);
    const scanId = uuidv4();
    
    console.log(`🚀 Nouveau scan: ${repoInfo.fullName}`);
    
    // Vérifier que le repo existe avec retry
    try {
      await retryGitHubCall(async () => {
        return await octokit.rest.repos.get({
          owner: repoInfo.owner,
          repo: repoInfo.repo
        });
      });
    } catch (error) {
      if (error.status === 404) {
        return res.status(404).json({ error: 'Repository non trouvé ou privé' });
      }
      console.error('❌ Erreur GitHub API:', error.message);
      return res.status(503).json({ 
        error: 'Impossible de contacter GitHub API', 
        details: error.message 
      });
    }
    
    // Créer le scan en base
    db.run(
      'INSERT INTO scans (id, github_url, repository) VALUES (?, ?, ?)',
      [scanId, githubUrl, repoInfo.fullName],
      async function(err) {
        if (err) {
          console.error('❌ Erreur base:', err);
          return res.status(500).json({ error: 'Erreur base de données' });
        }
        
        try {
          // Get callback URL from environment or construct it
          const callbackUrl = process.env.NGROK_URL ? 
            `${process.env.NGROK_URL}/api/scan-callback` : 
            `${req.protocol}://${req.get('host')}/api/scan-callback`;
          
          console.log(`📞 Callback URL: ${callbackUrl}`);
          
          // Déclencher GitHub Actions
          await retryGitHubCall(async () => {
            return await octokit.rest.actions.createWorkflowDispatch({
              owner: process.env.GITHUB_ACTIONS_OWNER,
              repo: process.env.GITHUB_ACTIONS_REPO,
              workflow_id: 'security-scan.yml',
              ref: 'main',
              inputs: {
                target_repo: githubUrl,
                scan_id: scanId,
                callback_url: callbackUrl
              }
            });
          });
          
          // Marquer comme running
          await updateScanStatus(scanId, 'running');
          
          const scan = {
            id: scanId,
            githubUrl,
            repository: repoInfo.fullName,
            status: 'running',
            startTime: new Date().toISOString(),
            callbackUrl: callbackUrl
          };
          
          res.json({
            success: true,
            scan,
            message: 'Scan démarré avec succès'
          });
          
        } catch (workflowError) {
          console.error('❌ Erreur workflow:', workflowError);
          await updateScanStatus(scanId, 'failed', {
            errorMessage: workflowError.message
          });
          
          res.status(500).json({
            error: 'Erreur lors du déclenchement du scan',
            details: workflowError.message
          });
        }
      }
    );
    
  } catch (error) {
    console.error('❌ Erreur scan:', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// Callback endpoint that matches GitHub Actions (scan-callback)
app.post('/api/scan-callback', async (req, res) => {
  try {
    console.log('📥 Callback reçu:', JSON.stringify(req.body, null, 2));

    const { scan_id, status, results, duration, files_scanned } = req.body;

    if (!scan_id) {
      return res.status(400).json({ error: 'scan_id requis' });
    }

    console.log(`📥 Résultats reçus pour ${scan_id}: ${status}`);

    // Vérifier que le scan existe
    db.get('SELECT * FROM scans WHERE id = ?', [scan_id], async (err, scan) => {
      if (err) {
        console.error('❌ Erreur base:', err);
        return res.status(500).json({ error: 'Erreur base de données' });
      }

      if (!scan) {
        console.error(`❌ Scan ${scan_id} non trouvé`);
        return res.status(404).json({ error: 'Scan non trouvé' });
      }

      try {
        // 🔹 Mettre à jour la table scans
        await updateScanStatus(scan_id, status, {
          results: results,
          duration: duration,
          files_scanned: files_scanned
        });

        // 🔹 Enregistrer les vulnérabilités si elles existent
        // ✅ CORRECTION: Utiliser detailed_vulnerabilities au lieu de vulnerabilities
        if (results && results.detailed_vulnerabilities && Array.isArray(results.detailed_vulnerabilities)) {
          console.log(`🛡️ Insertion de ${results.detailed_vulnerabilities.length} vulnérabilités dans la base...`);

          // Supprimer les anciennes vulnérabilités liées à ce scan (cas d'une ré-exécution)
          await new Promise((resolve, reject) => {
            db.run('DELETE FROM vulnerabilities WHERE scan_id = ?', [scan_id], (delErr) => {
              if (delErr) {
                console.error('❌ Erreur suppression vulnérabilités existantes:', delErr);
                return reject(delErr);
              }
              resolve();
            });
          });

          // Préparer l'insertion
          const stmt = db.prepare(`
            INSERT INTO vulnerabilities (
              scan_id, vuln_id, severity, title, description,
              package_name, version, fixed_version, reference_links
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          // ✅ CORRECTION: Utiliser detailed_vulnerabilities
          results.detailed_vulnerabilities.forEach(vuln => {
            stmt.run([
              scan_id,
              vuln.id || null,
              vuln.severity || null,
              vuln.title || null,
              vuln.description || null,
              vuln.package || null,  // Correspond à "package" dans tes données
              vuln.installed_version || null,  // ✅ CORRECTION: utiliser installed_version au lieu de version
              vuln.fixed_version || null,
              vuln.references ? JSON.stringify(vuln.references) : null
            ]);
          });

          stmt.finalize();
          console.log(`✅ ${results.detailed_vulnerabilities.length} vulnérabilités insérées en base`);
        } else {
          console.log('ℹ️ Aucune vulnérabilité détaillée trouvée dans les résultats');
        }

        console.log(`✅ Scan ${scan_id} mis à jour avec succès (incluant vulnérabilités)`);
        res.json({ success: true, message: 'Résultats enregistrés' });

      } catch (updateError) {
        console.error('❌ Erreur update:', updateError);
        res.status(500).json({ error: 'Erreur mise à jour' });
      }
    });

  } catch (error) {
    console.error('❌ Erreur callback:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// LEGACY: Keep old endpoint for backward compatibility
app.post('/api/scan/results', async (req, res) => {
  console.log('⚠️ Utilisation de l\'ancien endpoint /api/scan/results - redirection vers /api/scan-callback');
  // Redirect to new endpoint
  req.url = '/api/scan-callback';
  return app._router.handle(req, res);
});

// Lister les scans
app.get('/api/scans', (req, res) => {
  const { limit = 20, status, search } = req.query;
  
  let query = 'SELECT * FROM scans';
  let params = [];
  let conditions = [];
  
  if (status && status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }
  
  if (search) {
    conditions.push('repository LIKE ?');
    params.push(`%${search}%`);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY start_time DESC LIMIT ?';
  params.push(parseInt(limit));
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('❌ Erreur scans:', err);
      return res.status(500).json({ error: 'Erreur base de données' });
    }
    
    const scans = rows.map(row => ({
      ...row,
      results: row.results ? JSON.parse(row.results) : null
    }));
    
    res.json(scans);
  });
});

// Détails d'un scan
app.get('/api/scan/:id', (req, res) => {
  const { id } = req.params;
  
  db.get('SELECT * FROM scans WHERE id = ?', [id], (err, scan) => {
    if (err) {
      console.error('❌ Erreur scan:', err);
      return res.status(500).json({ error: 'Erreur base de données' });
    }
    
    if (!scan) {
      return res.status(404).json({ error: 'Scan non trouvé' });
    }
    
    const scanData = {
      ...scan,
      results: scan.results ? JSON.parse(scan.results) : null
    };
    
    res.json(scanData);
  });
});

// ✅ NOUVEAU: Endpoint pour récupérer les vulnérabilités d'un scan
app.get('/api/scan/:id/vulnerabilities', (req, res) => {
  const { id } = req.params;
  
  db.all('SELECT * FROM vulnerabilities WHERE scan_id = ?', [id], (err, vulns) => {
    if (err) {
      console.error('❌ Erreur vulnérabilités:', err);
      return res.status(500).json({ error: 'Erreur base de données' });
    }
    
    // Parser les références JSON
    const vulnerabilities = vulns.map(vuln => ({
      ...vuln,
      reference_links: vuln.reference_links ? JSON.parse(vuln.reference_links) : []
    }));
    
    res.json(vulnerabilities || []);
  });
});

// Statistiques
app.get('/api/stats', (req, res) => {
  const query = `
    SELECT 
      COUNT(*) as total_scans,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_scans,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_scans,
      COUNT(CASE WHEN status = 'running' THEN 1 END) as running_scans,
      AVG(duration) as avg_duration,
      SUM(files_scanned) as total_files_scanned
    FROM scans
  `;
  
  db.get(query, [], (err, stats) => {
    if (err) {
      console.error('❌ Erreur stats:', err);
      return res.status(500).json({ error: 'Erreur base de données' });
    }
    
    res.json(stats || {});
  });
});

// ✅ NOUVEAU: Statistiques des vulnérabilités
app.get('/api/stats/vulnerabilities', (req, res) => {
  const query = `
    SELECT 
      COUNT(*) as total_vulnerabilities,
      COUNT(CASE WHEN severity = 'CRITICAL' THEN 1 END) as critical,
      COUNT(CASE WHEN severity = 'HIGH' THEN 1 END) as high,
      COUNT(CASE WHEN severity = 'MEDIUM' THEN 1 END) as medium,
      COUNT(CASE WHEN severity = 'LOW' THEN 1 END) as low,
      COUNT(DISTINCT package_name) as unique_packages
    FROM vulnerabilities
  `;
  
  db.get(query, [], (err, stats) => {
    if (err) {
      console.error('❌ Erreur stats vulnérabilités:', err);
      return res.status(500).json({ error: 'Erreur base de données' });
    }
    
    res.json(stats || {});
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: 'connected',
    websocket: wsServer ? 'active' : 'inactive',
    clients: clients.size,
    environment: {
      port: PORT,
      github_token: GITHUB_TOKEN ? 'configured' : 'missing',
      ngrok_url: process.env.NGROK_URL || 'not_set'
    }
  });
});

// Route par défaut
app.get('/', (req, res) => {
  res.json({
    name: 'Security Scanner API',
    version: '1.0.0',
    status: 'running',
    endpoints: [
      'POST /api/scan/trigger',
      'POST /api/scan-callback',
      'POST /api/scan/results (legacy)',
      'GET /api/scans',
      'GET /api/scan/:id',
      'GET /api/scan/:id/vulnerabilities',
      'GET /api/stats',
      'GET /api/stats/vulnerabilities',
      'GET /health'
    ]
  });
});

// Démarrage serveur
const server = app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📊 API disponible sur http://localhost:${PORT}`);
  console.log(`📞 Callback endpoint: http://localhost:${PORT}/api/scan-callback`);
  if (process.env.NGROK_URL) {
    console.log(`🌐 Ngrok URL: ${process.env.NGROK_URL}/api/scan-callback`);
  } else {
    console.log('⚠️ NGROK_URL non défini dans .env');
  }
});

// WebSocket
wsServer = new WebSocketServer({ server });

wsServer.on('connection', (ws) => {
  console.log('🔌 Nouvelle connexion WebSocket');
  clients.add(ws);
  
  ws.send(JSON.stringify({
    type: 'connection',
    message: 'Connexion WebSocket établie'
  }));
  
  ws.on('close', () => {
    console.log('🔌 Connexion WebSocket fermée');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('❌ Erreur WebSocket:', error);
    clients.delete(ws);
  });
});

// Arrêt propre
process.on('SIGTERM', () => {
  console.log('🛑 Arrêt du serveur...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Arrêt du serveur...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
