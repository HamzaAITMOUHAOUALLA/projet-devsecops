import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Bug,
  CheckCircle,
  Clock,
  Download,
  Eye,
  Info,
  Moon,
  RotateCcw,
  Search,
  Shield,
  Sun,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

// ✅ Service API mis à jour pour utiliser la nouvelle API backend
const apiService = {
  baseUrl: "http://localhost:3001",

  async startScan(githubUrl, scanDepth = "standard") {
    console.log("🚀 Démarrage du scan:", { githubUrl, scanDepth });

    try {
      const response = await fetch(`${this.baseUrl}/api/scan/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          githubUrl,
          scanDepth,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();
      console.log("✅ Scan démarré:", result);
      return result;
    } catch (error) {
      console.error("❌ Erreur démarrage scan:", error);
      throw error;
    }
  },

  // ✅ NOUVEAU: Récupérer les vulnérabilités depuis la nouvelle API
  async getScanVulnerabilities(scanId) {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/scan/${scanId}/vulnerabilities`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("❌ Erreur vulnérabilités scan:", error);
      throw error;
    }
  },

  // ✅ Export amélioré avec vraies données de la DB
  async exportVulnerabilities(scanId) {
    try {
      // Get vulnerabilities from database
      const vulnerabilities = await this.getScanVulnerabilities(scanId);

      // Convert to CSV
      const csvContent = this.convertToCSV(vulnerabilities);
      // Download file
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vulnerabilities-${scanId}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      return { success: true };
    } catch (error) {
      console.error("❌ Erreur export:", error);
      throw error;
    }
  },

  convertToCSV(vulnerabilities) {
    if (!vulnerabilities || vulnerabilities.length === 0) {
      return "No vulnerabilities found";
    }

    const headers = [
      "Vulnerability ID",
      "Title",
      "Severity",
      "Package",
      "Installed Version",
      "Fixed Version",
      "Description",
      "References",
    ];

    const rows = vulnerabilities.map((vuln) => [
      vuln.vuln_id || "",
      vuln.title || "",
      vuln.severity || "",
      vuln.package_name || "",
      vuln.version || "",
      vuln.fixed_version || "",
      (vuln.description || "").replace(/"/g, '""'), // Escape quotes
      vuln.reference_links || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((field) => `"${field}"`).join(",")),
    ].join("\n");

    return csvContent;
  },

  async getScans(params = {}) {
    const { limit = 20, status = "all", search = "" } = params;
    const queryParams = new URLSearchParams({
      limit: limit.toString(),
      status,
      search,
    });

    try {
      const response = await fetch(`${this.baseUrl}/api/scans?${queryParams}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("❌ Erreur récupération scans:", error);
      throw error;
    }
  },

  async getStats() {
    try {
      const response = await fetch(`${this.baseUrl}/api/stats`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("❌ Erreur stats:", error);
      throw error;
    }
  },

  // ✅ NOUVEAU: Statistiques des vulnérabilités
  async getVulnerabilitiesStats() {
    try {
      const response = await fetch(`${this.baseUrl}/api/stats/vulnerabilities`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("❌ Erreur stats vulnérabilités:", error);
      throw error;
    }
  },
};

// ✅ WebSocket service simplifié pour les mises à jour temps réel
class WebSocketService {
  constructor() {
    this.callbacks = {};
    this.pollInterval = null;
    this.isPolling = false;
  }

  subscribe(key, callback) {
    this.callbacks[key] = callback;
  }

  unsubscribe(key) {
    delete this.callbacks[key];
  }

  // ✅ Start polling only if needed and with proper cleanup
  startPolling(fetchRunningScans) {
    if (this.isPolling || this.pollInterval) return;

    this.isPolling = true;
    console.log("🔄 Starting polling for running scans...");

    this.pollInterval = setInterval(async () => {
      try {
        const hasRunning = await fetchRunningScans();
        if (!hasRunning) {
          console.log("✅ No running scans, stopping polling");
          this.stopPolling();
          return;
        }

        // Only trigger updates if we have callbacks
        if (Object.keys(this.callbacks).length > 0) {
          Object.values(this.callbacks).forEach((cb) => {
            try {
              cb({ type: "poll_update" });
            } catch (error) {
              console.error("❌ Error in callback:", error);
            }
          });
        }
      } catch (error) {
        console.error("❌ Error during polling:", error);
        // Stop polling on error to prevent infinite failures
        this.stopPolling();
      }
    }, 3000); // Reduced from 5000 to 3000 for faster updates
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
    console.log("🛑 Polling stopped");
  }

  // Cleanup method
  cleanup() {
    this.stopPolling();
    this.callbacks = {};
  }
}

// Create global WebSocket instance
const wsService = new WebSocketService();

const themeUtils = {
  save(darkMode) {
    try {
      const themeData = {
        darkMode,
        timestamp: Date.now(),
      };
      // Store the theme in localStorage
      localStorage.setItem("themePreference", JSON.stringify(themeData));
    } catch (error) {
      console.warn("Could not save theme preference:", error);
    }
  },

  load() {
    try {
      const stored = localStorage.getItem("themePreference");
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.darkMode;
      }
      // Default to dark mode if nothing stored
      return true;
    } catch (error) {
      console.warn("Could not load theme preference:", error);
      return true;
    }
  },
};

function App() {
  // ✅ Initialize theme from saved preference (localStorage)
  const [darkMode, setDarkMode] = useState(() => themeUtils.load());

  // ✅ Save to localStorage when toggled
  const handleThemeToggle = useCallback(() => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    themeUtils.save(newDarkMode);
  }, [darkMode]);

  // ✅ Theme classes
  const theme = useMemo(
    () => ({
      bg: darkMode ? "bg-gray-900" : "bg-gray-50",
      cardBg: darkMode ? "bg-gray-800" : "bg-white",
      text: darkMode ? "text-white" : "text-gray-900",
      textMuted: darkMode ? "text-gray-400" : "text-gray-600",
      border: darkMode ? "border-gray-700" : "border-gray-200",
      primary: "text-blue-500",
      success: "text-green-500",
      warning: "text-yellow-500",
      danger: "text-red-500",
      info: "text-blue-500",
    }),
    [darkMode]
  );


  // États principaux
  const [githubUrl, setGithubUrl] = useState("");
  const [scans, setScans] = useState([]);
  const [currentScan, setCurrentScan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({});
  const [vulnStats, setVulnStats] = useState({});

  // États de l'interface
  const [selectedScan, setSelectedScan] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [scanDepth, setScanDepth] = useState("standard");
  const [selectedVulnerabilities, setSelectedVulnerabilities] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("connected");

  // ✅ FIXED: Save theme when it changes
  

  // Gestion des notifications
  const addNotification = useCallback(
    (message, type = "info", persistent = false) => {
      const id = Date.now();
      const notification = {
        id,
        message,
        type,
        timestamp: new Date(),
        persistent,
      };

      setNotifications((prev) => [notification, ...prev.slice(0, 9)]);

      if (!persistent && (type === "success" || type === "info")) {
        setTimeout(() => {
          setNotifications((prev) => prev.filter((n) => n.id !== id));
        }, 5000);
      }
    },
    []
  );

  // ✅ FIXED: Improved polling management with proper cleanup
  const managePolling = useCallback(async () => {
    try {
      const runningScans = await apiService.getScans({ status: "running" });
      const hasRunning = runningScans && runningScans.length > 0;

      if (hasRunning) {
        console.log("🚀 Starting polling for running scans");
        wsService.startPolling(async () => {
          try {
            const currentRunning = await apiService.getScans({
              status: "running",
            });
            return currentRunning && currentRunning.length > 0;
          } catch (error) {
            console.error("Error checking running scans:", error);
            return false;
          }
        });
      } else {
        console.log("✅ No running scans, stopping polling");
        wsService.stopPolling();
      }
    } catch (error) {
      console.error("❌ Error managing polling:", error);
      wsService.stopPolling();
    }
  }, []);

  // ✅ FIXED: Improved WebSocket/Polling setup with better cleanup
  useEffect(() => {
    let mounted = true;

    // Function to check if there are any running scans
    const fetchRunningScans = async () => {
      try {
        if (!mounted) return false;
        const data = await apiService.getScans({ status: "running" });
        const hasRunning = data && data.length > 0;
        console.log(
          "🔍 Running scans check:",
          hasRunning ? `${data.length} running` : "none"
        );
        return hasRunning;
      } catch (error) {
        console.error("❌ Error checking running scans:", error);
        return false;
      }
    };

    // Subscribe to updates
    const updateCallback = async (data) => {
      if (!mounted) return;

      if (data.type === "poll_update" || data.type === "scan_update") {
        console.log("📡 Received update:", data.type);
        try {
          // Fetch updates with error handling
          await Promise.all([
            fetchScans().catch((err) =>
              console.error("Error fetching scans:", err)
            ),
            fetchStats().catch((err) =>
              console.error("Error fetching stats:", err)
            ),
            fetchVulnStats().catch((err) =>
              console.error("Error fetching vuln stats:", err)
            ),
          ]);

          // Check if we should stop polling after updates
          setTimeout(() => {
            if (mounted) {
              managePolling().catch((err) =>
                console.error("Error managing polling:", err)
              );
            }
          }, 1000);
        } catch (error) {
          console.error("Error during update:", error);
        }
      }
    };

    wsService.subscribe("all", updateCallback);

    // Start polling if there are running scans
    const checkAndStartPolling = async () => {
      if (!mounted) return;
      try {
        const hasRunning = await fetchRunningScans();
        if (hasRunning && mounted) {
          wsService.startPolling(fetchRunningScans);
        }
      } catch (error) {
        console.error("Error in initial polling check:", error);
      }
    };

    checkAndStartPolling();

    return () => {
      mounted = false;
      wsService.unsubscribe("all");
      // Don't cleanup wsService entirely as it might be used by other components
      // wsService.cleanup();
    };
  }, [managePolling]);

  // ✅ FIXED: Improved scan fetching with better error handling
  const fetchScans = useCallback(
    async (retries = 3) => {
      try {
        const data = await apiService.getScans({
          limit: 50,
          status: filterStatus,
          search: searchTerm,
        });

        if (Array.isArray(data)) {
          setScans(data);

          // ✅ Mise à jour du scan courant s'il existe
          if (currentScan) {
            const updatedCurrentScan = data.find(
              (scan) => scan.id === currentScan.id
            );
            if (updatedCurrentScan) {
              setCurrentScan(updatedCurrentScan);

              // ✅ FIXED: Clear current scan when completed to prevent UI blocking
              if (
                updatedCurrentScan.status === "completed" ||
                updatedCurrentScan.status === "failed"
              ) {
                // Keep showing results for a brief moment then clear
                setTimeout(() => {
                  setCurrentScan(null);
                  setLoading(false); // Ensure loading is cleared
                }, 3000);
              }
            }
          }
        }
      } catch (err) {
        console.error("❌ Erreur récupération scans:", err);
        if (retries > 0) {
          setTimeout(() => fetchScans(retries - 1), 2000);
        } else {
          addNotification("Impossible de charger l'historique", "error", true);
        }
      }
    },
    [filterStatus, searchTerm, addNotification, currentScan]
  );

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiService.getStats();
      setStats(data);
    } catch (error) {
      console.error("❌ Erreur stats:", error);
    }
  }, []);

  // ✅ NOUVEAU: Récupérer les stats des vulnérabilités
  const fetchVulnStats = useCallback(async () => {
    try {
      const data = await apiService.getVulnerabilitiesStats();
      setVulnStats(data);
    } catch (error) {
      console.error("❌ Erreur stats vulnérabilités:", error);
    }
  }, []);

  useEffect(() => {
    fetchScans();
    fetchStats();
    fetchVulnStats();
  }, [fetchScans, fetchStats, fetchVulnStats]);

  // Validation URL GitHub
  const isValidGitHubUrl = (url) => {
    const githubRegex =
      /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/?$/;
    return githubRegex.test(url.trim());
  };

  // ✅ FIXED: Improved scan handling with better state management
  const handleScan = async (e) => {
    e.preventDefault();

    if (!isValidGitHubUrl(githubUrl)) {
      const errorMsg =
        "Veuillez entrer une URL GitHub valide (ex: https://github.com/user/repo)";
      setError(errorMsg);
      addNotification(errorMsg, "error");
      return;
    }

    setLoading(true);
    setError(null);
    setCurrentScan(null);

    try {
      console.log("🚀 Démarrage du scan...", { githubUrl, scanDepth });

      const result = await apiService.startScan(githubUrl, scanDepth);

      if (result.success && result.scan) {
        setCurrentScan(result.scan);
        setGithubUrl("");
        addNotification(
          `🚀 Scan démarré pour ${result.scan.repository}`,
          "success"
        );
        fetchStats();

        // ✅ FIXED: Clear loading immediately after successful start
        setLoading(false);

        // Start monitoring the scan
        managePolling();
      } else {
        throw new Error(result.error || "Réponse invalide du serveur");
      }
    } catch (err) {
      const errorMsg = err.message || "Erreur lors du démarrage du scan";
      setError(errorMsg);
      addNotification(errorMsg, "error", true);
      console.error("❌ Erreur scan:", err);
      setLoading(false);
    }
  };

  // Filtrage des scans
  const filteredScans = useMemo(() => {
    return scans
      .filter((scan) => {
        const matchesSearch =
          !searchTerm ||
          scan.repository?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          scan.github_url?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFilter =
          filterStatus === "all" || scan.status === filterStatus;
        return matchesSearch && matchesFilter;
      })
      .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
  }, [scans, searchTerm, filterStatus]);

  // ✅ Fonctions utilitaires améliorées
  const getStatusIcon = (status) => {
    switch (status) {
      case "pending":
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case "running":
        return <div className="w-5 h-5 text-blue-500 animate-spin">⚡</div>;
      case "completed":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  const getStatusLabel = (status) => {
    const labels = {
      pending: "En attente",
      running: "En cours",
      completed: "Terminé",
      failed: "Échoué",
    };
    return labels[status] || "Inconnu";
  };

  const getSeverityColor = (severity) => {
    const colors = {
      CRITICAL: "bg-red-600",
      HIGH: "bg-orange-600",
      MEDIUM: "bg-yellow-600",
      LOW: "bg-green-600",
    };
    return colors[severity] || "bg-gray-600";
  };

  // ✅ Calcul des vulnérabilités depuis les résultats stockés
  const getVulnerabilitiesFromResults = (scan) => {
    if (!scan.results || !scan.results.detailed_vulnerabilities) {
      return { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
    }

    const vulns = scan.results.detailed_vulnerabilities;
    return {
      total: vulns.length,
      critical: vulns.filter((v) => v.severity === "CRITICAL").length,
      high: vulns.filter((v) => v.severity === "HIGH").length,
      medium: vulns.filter((v) => v.severity === "MEDIUM").length,
      low: vulns.filter((v) => v.severity === "LOW").length,
    };
  };

  // Composants UI
  const StatCard = ({ title, value, icon, color = "blue", subtitle }) => (
    <div
      className={`${theme.cardBg} p-6 rounded-lg shadow-sm ${theme.border} border`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-sm font-medium ${theme.textMuted}`}>{title}</p>
          <p className={`text-3xl font-bold ${theme.text}`}>{value || 0}</p>
          {subtitle && (
            <p className={`text-xs ${theme.textMuted} mt-1`}>{subtitle}</p>
          )}
        </div>
        <div className={`text-${color}-500 text-2xl`}>{icon}</div>
      </div>
    </div>
  );

  const NotificationPanel = () => (
    <div
      className={`fixed top-4 right-4 z-50 space-y-3 ${
        showNotifications ? "block" : "hidden"
      }`}
    >
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`${
            theme.cardBg
          } border-l-4 p-4 rounded-lg shadow-lg max-w-sm ${
            notification.type === "success"
              ? "border-green-500"
              : notification.type === "error"
              ? "border-red-500"
              : notification.type === "warning"
              ? "border-yellow-500"
              : "border-blue-500"
          }`}
        >
          <div className="flex items-start">
            <div className="flex-shrink-0">
              {notification.type === "success" && (
                <CheckCircle className="w-5 h-5 text-green-500" />
              )}
              {notification.type === "error" && (
                <XCircle className="w-5 h-5 text-red-500" />
              )}
              {notification.type === "warning" && (
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
              )}
              {notification.type === "info" && (
                <Info className="w-5 h-5 text-blue-500" />
              )}
            </div>
            <div className="ml-3 flex-1">
              <p className={`text-sm font-medium ${theme.text}`}>
                {notification.message}
              </p>
              <p className={`text-xs ${theme.textMuted} mt-1`}>
                {notification.timestamp.toLocaleTimeString("fr-FR")}
              </p>
            </div>
            <button
              onClick={() =>
                setNotifications((prev) =>
                  prev.filter((n) => n.id !== notification.id)
                )
              }
              className={`ml-3 ${theme.textMuted} hover:text-gray-900`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  const ScanForm = () => (
    <div
      className={`${theme.cardBg} p-6 rounded-lg shadow-sm ${theme.border} border`}
    >
      <h2 className={`text-xl font-bold ${theme.text} mb-6 flex items-center`}>
        <Shield className="w-6 h-6 mr-2" />
        Nouveau scan de sécurité
      </h2>

      <form onSubmit={handleScan} className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8">
            <label className={`block text-sm font-medium ${theme.text} mb-2`}>
              URL du dépôt GitHub
            </label>
            <input
              type="url"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://github.com/username/repository"
              disabled={loading}
              className={`w-full px-4 py-3 ${theme.cardBg} ${
                theme.border
              } border rounded-lg ${
                theme.text
              } focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
                error ? "border-red-500" : ""
              }`}
            />
          </div>

          <div className="lg:col-span-2">
            <label className={`block text-sm font-medium ${theme.text} mb-2`}>
              Profondeur
            </label>
            <select
              value={scanDepth}
              onChange={(e) => setScanDepth(e.target.value)}
              disabled={loading}
              className={`w-full px-4 py-3 ${theme.cardBg} ${theme.border} border rounded-lg ${theme.text} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            >
              <option value="standard">Standard</option>
              <option value="deep">Approfondi</option>
            </select>
          </div>

          <div className="lg:col-span-2 flex items-end">
            <button
              type="submit"
              disabled={loading || !githubUrl.trim()}
              className={`w-full px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                loading || !githubUrl.trim()
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              } text-white flex items-center justify-center`}
            >
              {loading ? (
                <>
                  <div className="animate-spin mr-2 w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                  Démarrage...
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 mr-2" />
                  Scanner
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center">
              <XCircle className="w-5 h-5 text-red-500 mr-2" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}
      </form>
    </div>
  );

  // ✅ Composant de statut de scan amélioré
  const CurrentScanStatus = () => {
    if (!currentScan) return null;

    const duration = currentScan.completed_at
      ? Math.round(
          (new Date(currentScan.completed_at) -
            new Date(currentScan.start_time)) /
            1000
        )
      : Math.round((Date.now() - new Date(currentScan.start_time)) / 1000);

    const vulnCounts = getVulnerabilitiesFromResults(currentScan);

    return (
      <div
        className={`${theme.cardBg} p-6 rounded-lg shadow-sm ${theme.border} border`}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center">
            {getStatusIcon(currentScan.status)}
            <div className="ml-3">
              <h3 className={`text-lg font-semibold ${theme.text}`}>
                Scan {getStatusLabel(currentScan.status)}
              </h3>
              <p className={`${theme.textMuted}`}>
                📦 {currentScan.repository}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div
              className={`px-3 py-1 rounded-full text-xs font-medium ${
                currentScan.status === "completed"
                  ? "bg-green-100 text-green-800"
                  : currentScan.status === "running"
                  ? "bg-blue-100 text-blue-800"
                  : currentScan.status === "failed"
                  ? "bg-red-100 text-red-800"
                  : "bg-yellow-100 text-yellow-800"
              }`}
            >
              {getStatusLabel(currentScan.status)}
            </div>

            {/* ✅ FIXED: Add close button to manually clear current scan */}
            {(currentScan.status === "completed" ||
              currentScan.status === "failed") && (
              <button
                onClick={() => setCurrentScan(null)}
                className={`p-1 ${theme.textMuted} hover:text-gray-700 transition-colors`}
                title="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className={`text-sm ${theme.textMuted}`}>Démarré</p>
            <p className={`font-medium ${theme.text}`}>
              {new Date(currentScan.start_time).toLocaleString("fr-FR")}
            </p>
          </div>
          <div>
            <p className={`text-sm ${theme.textMuted}`}>Durée</p>
            <p className={`font-medium ${theme.text}`}>{duration}s</p>
          </div>
          {currentScan.files_scanned && (
            <div>
              <p className={`text-sm ${theme.textMuted}`}>Fichiers</p>
              <p className={`font-medium ${theme.text}`}>
                {currentScan.files_scanned}
              </p>
            </div>
          )}
          {currentScan.status === "completed" && (
            <div>
              <p className={`text-sm ${theme.textMuted}`}>Vulnérabilités</p>
              <p className={`font-medium ${theme.text}`}>{vulnCounts.total}</p>
            </div>
          )}
        </div>

        {currentScan.status === "running" && (
          <div className="mt-4">
            <div className="bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full animate-pulse"
                style={{ width: "60%" }}
              ></div>
            </div>
            <p className={`text-sm ${theme.textMuted} mt-2`}>
              🔍 Analyse en cours...
            </p>
          </div>
        )}

        {/* ✅ Affichage des résultats de vulnérabilités */}
        {currentScan.status === "completed" && vulnCounts.total > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className={`font-semibold ${theme.text}`}>
                Vulnérabilités détectées
              </h4>
              <div className="flex space-x-2">
                <button
                  onClick={() => setSelectedVulnerabilities(currentScan)}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                >
                  <Eye className="w-4 h-4 inline mr-1" />
                  Détails
                </button>
                <button
                  onClick={() =>
                    apiService.exportVulnerabilities(currentScan.id)
                  }
                  className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                >
                  <Download className="w-4 h-4 inline mr-1" />
                  CSV
                </button>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {vulnCounts.critical > 0 && (
                <div className="bg-red-600 text-white text-center py-2 rounded text-sm">
                  <div className="font-bold">{vulnCounts.critical}</div>
                  <div>Critiques</div>
                </div>
              )}
              {vulnCounts.high > 0 && (
                <div className="bg-orange-600 text-white text-center py-2 rounded text-sm">
                  <div className="font-bold">{vulnCounts.high}</div>
                  <div>Élevées</div>
                </div>
              )}
              {vulnCounts.medium > 0 && (
                <div className="bg-yellow-600 text-white text-center py-2 rounded text-sm">
                  <div className="font-bold">{vulnCounts.medium}</div>
                  <div>Moyennes</div>
                </div>
              )}
              {vulnCounts.low > 0 && (
                <div className="bg-green-600 text-white text-center py-2 rounded text-sm">
                  <div className="font-bold">{vulnCounts.low}</div>
                  <div>Faibles</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ✅ FIXED: Show success message when no vulnerabilities */}
        {currentScan.status === "completed" && vulnCounts.total === 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="text-center py-4">
              <Shield className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <h4 className={`font-semibold ${theme.text}`}>
                Scan terminé avec succès
              </h4>
              <p className={`text-sm ${theme.textMuted}`}>
                Aucune vulnérabilité détectée dans ce dépôt
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ✅ Table d'historique mise à jour
  const ScanHistoryTable = () => (
    <div
      className={`${theme.cardBg} rounded-lg shadow-sm ${theme.border} border`}
    >
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className={`text-lg font-semibold ${theme.text}`}>
            Historique des scans
          </h3>

          <div className="flex space-x-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`pl-10 pr-4 py-2 ${theme.cardBg} ${theme.border} border rounded-lg ${theme.text} focus:outline-none focus:ring-2 focus:ring-blue-500 w-64`}
              />
            </div>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className={`px-4 py-2 ${theme.cardBg} ${theme.border} border rounded-lg ${theme.text} focus:outline-none focus:ring-2 focus:ring-blue-500`}
            >
              <option value="all">Tous les statuts</option>
              <option value="completed">Terminés</option>
              <option value="running">En cours</option>
              <option value="failed">Échoués</option>
              <option value="pending">En attente</option>
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        {filteredScans.length === 0 ? (
          <div className="p-12 text-center">
            <div className={`text-6xl mb-4 ${theme.textMuted}`}>📊</div>
            <p className={`text-lg ${theme.textMuted}`}>
              {searchTerm || filterStatus !== "all"
                ? "Aucun scan ne correspond à vos critères"
                : "Aucun scan enregistré pour le moment"}
            </p>
          </div>
        ) : (
          <table className="min-w-full">
            <thead className={`bg-gray-50 ${darkMode ? "bg-gray-700" : ""}`}>
              <tr>
                <th
                  className={`px-6 py-3 text-left text-xs font-medium ${theme.textMuted} uppercase tracking-wider`}
                >
                  Dépôt
                </th>
                <th
                  className={`px-6 py-3 text-left text-xs font-medium ${theme.textMuted} uppercase tracking-wider`}
                >
                  Statut
                </th>
                <th
                  className={`px-6 py-3 text-left text-xs font-medium ${theme.textMuted} uppercase tracking-wider`}
                >
                  Vulnérabilités
                </th>
                <th
                  className={`px-6 py-3 text-left text-xs font-medium ${theme.textMuted} uppercase tracking-wider`}
                >
                  Date
                </th>
                <th
                  className={`px-6 py-3 text-left text-xs font-medium ${theme.textMuted} uppercase tracking-wider`}
                >
                  Durée
                </th>
                <th
                  className={`px-6 py-3 text-right text-xs font-medium ${theme.textMuted} uppercase tracking-wider`}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredScans.map((scan) => {
                const vulnCounts = getVulnerabilitiesFromResults(scan);
                const duration = scan.completed_at
                  ? Math.round(
                      (new Date(scan.completed_at) -
                        new Date(scan.start_time)) /
                        1000
                    )
                  : null;

                return (
                  <tr
                    key={scan.id}
                    className={`hover:${
                      darkMode ? "bg-gray-700" : "bg-gray-50"
                    } transition-colors cursor-pointer`}
                    onClick={() => setSelectedScan(scan)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Shield className="w-5 h-5 text-blue-600" />
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className={`text-sm font-medium ${theme.text}`}>
                            {scan.repository}
                          </div>
                          <div className={`text-sm ${theme.textMuted}`}>
                            {scan.files_scanned
                              ? `${scan.files_scanned} fichiers`
                              : "En cours..."}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {getStatusIcon(scan.status)}
                        <span
                          className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${
                            scan.status === "completed"
                              ? "bg-green-100 text-green-800"
                              : scan.status === "running"
                              ? "bg-blue-100 text-blue-800"
                              : scan.status === "failed"
                              ? "bg-red-100 text-red-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {getStatusLabel(scan.status)}
                        </span>
                      </div>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      {scan.status === "completed" ? (
                        <div className="flex items-center space-x-2">
                          <div
                            className={`text-lg font-bold ${
                              vulnCounts.total === 0
                                ? "text-green-600"
                                : vulnCounts.critical > 0
                                ? "text-red-600"
                                : vulnCounts.high > 0
                                ? "text-orange-600"
                                : "text-yellow-600"
                            }`}
                          >
                            {vulnCounts.total}
                          </div>
                          {vulnCounts.critical > 0 && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              {vulnCounts.critical} critique
                              {vulnCounts.critical > 1 ? "s" : ""}
                            </span>
                          )}
                          {vulnCounts.high > 0 && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                              {vulnCounts.high} élevée
                              {vulnCounts.high > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className={`text-sm ${theme.textMuted}`}>
                          {scan.status === "running" ? "En analyse..." : "-"}
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`text-sm ${theme.text}`}>
                        {new Date(scan.start_time).toLocaleDateString("fr-FR")}
                      </div>
                      <div className={`text-sm ${theme.textMuted}`}>
                        {new Date(scan.start_time).toLocaleTimeString("fr-FR")}
                      </div>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-sm ${theme.text}`}>
                        {duration ? `${duration}s` : "-"}
                      </span>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        {scan.status === "completed" &&
                          vulnCounts.total > 0 && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedVulnerabilities(scan);
                                }}
                                className="text-blue-600 hover:text-blue-900 transition-colors"
                                title="Voir les vulnérabilités"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  apiService.exportVulnerabilities(scan.id);
                                }}
                                className="text-green-600 hover:text-green-900 transition-colors"
                                title="Exporter en CSV"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const repoUrl =
                              scan.github_url ||
                              `https://github.com/${scan.repository}`;
                            setGithubUrl(repoUrl);
                            setScanDepth("standard");
                            window.scrollTo({ top: 0, behavior: "smooth" });
                            addNotification(
                              `URL copiée: ${scan.repository}`,
                              "info"
                            );
                          }}
                          className="text-indigo-600 hover:text-indigo-900 transition-colors"
                          title="Relancer le scan"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  // Modal de détails d'un scan
  const ScanDetailsModal = () => {
    if (!selectedScan) return null;

    const vulnCounts = getVulnerabilitiesFromResults(selectedScan);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div
          className={`${theme.cardBg} rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto`}
        >
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Shield className="w-6 h-6 mr-3 text-blue-600" />
                <div>
                  <h2 className={`text-xl font-bold ${theme.text}`}>
                    {selectedScan.repository}
                  </h2>
                  <p className={`${theme.textMuted}`}>
                    Scan #{selectedScan.id}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedScan(null)}
                className={`${theme.textMuted} hover:text-gray-700 transition-colors`}
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Informations générales */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div
                className={`p-4 ${
                  darkMode ? "bg-gray-700" : "bg-gray-50"
                } rounded-lg`}
              >
                <p className={`text-sm font-medium ${theme.textMuted} mb-1`}>
                  Statut
                </p>
                <div className="flex items-center">
                  {getStatusIcon(selectedScan.status)}
                  <span className={`ml-2 font-semibold ${theme.text}`}>
                    {getStatusLabel(selectedScan.status)}
                  </span>
                </div>
              </div>

              <div
                className={`p-4 ${
                  darkMode ? "bg-gray-700" : "bg-gray-50"
                } rounded-lg`}
              >
                <p className={`text-sm font-medium ${theme.textMuted} mb-1`}>
                  Date de début
                </p>
                <p className={`font-semibold ${theme.text}`}>
                  {new Date(selectedScan.start_time).toLocaleString("fr-FR")}
                </p>
              </div>

              {selectedScan.completed_at && (
                <div
                  className={`p-4 ${
                    darkMode ? "bg-gray-700" : "bg-gray-50"
                  } rounded-lg`}
                >
                  <p className={`text-sm font-medium ${theme.textMuted} mb-1`}>
                    Durée
                  </p>
                  <p className={`font-semibold ${theme.text}`}>
                    {Math.round(
                      (new Date(selectedScan.completed_at) -
                        new Date(selectedScan.start_time)) /
                        1000
                    )}
                    s
                  </p>
                </div>
              )}

              {selectedScan.files_scanned && (
                <div
                  className={`p-4 ${
                    darkMode ? "bg-gray-700" : "bg-gray-50"
                  } rounded-lg`}
                >
                  <p className={`text-sm font-medium ${theme.textMuted} mb-1`}>
                    Fichiers analysés
                  </p>
                  <p className={`font-semibold ${theme.text}`}>
                    {selectedScan.files_scanned}
                  </p>
                </div>
              )}
            </div>

            {/* Résultats de sécurité */}
            {selectedScan.status === "completed" && vulnCounts.total >= 0 && (
              <div>
                <h3 className={`text-lg font-semibold ${theme.text} mb-4`}>
                  Résultats de sécurité
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  {[
                    {
                      key: "critical",
                      label: "Critiques",
                      count: vulnCounts.critical,
                      color: "bg-red-600",
                    },
                    {
                      key: "high",
                      label: "Élevées",
                      count: vulnCounts.high,
                      color: "bg-orange-600",
                    },
                    {
                      key: "medium",
                      label: "Moyennes",
                      count: vulnCounts.medium,
                      color: "bg-yellow-600",
                    },
                    {
                      key: "low",
                      label: "Faibles",
                      count: vulnCounts.low,
                      color: "bg-green-600",
                    },
                  ].map(({ key, label, count, color }) => (
                    <div
                      key={key}
                      className={`p-4 rounded-lg text-center text-white ${
                        count > 0 ? color : "bg-gray-400"
                      }`}
                    >
                      <div className="text-2xl font-bold">{count}</div>
                      <div className="text-sm opacity-90">{label}</div>
                    </div>
                  ))}
                </div>

                <div className="flex space-x-3">
                  {vulnCounts.total > 0 && (
                    <>
                      <button
                        onClick={() => setSelectedVulnerabilities(selectedScan)}
                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Voir les détails des vulnérabilités ({vulnCounts.total})
                      </button>

                      <button
                        onClick={() =>
                          apiService.exportVulnerabilities(selectedScan.id)
                        }
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Export CSV
                      </button>
                    </>
                  )}

                  {vulnCounts.total === 0 && (
                    <div className="flex-1 text-center py-4">
                      <Shield className="w-12 h-12 text-green-500 mx-auto mb-2" />
                      <p className={`font-medium ${theme.text}`}>
                        Aucune vulnérabilité détectée
                      </p>
                      <p className={`text-sm ${theme.textMuted}`}>
                        Ce dépôt semble sécurisé!
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Message d'erreur */}
            {selectedScan.error_message && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center">
                  <XCircle className="w-5 h-5 text-red-500 mr-2" />
                  <div>
                    <h4 className="font-medium text-red-800">
                      Erreur durant l'exécution
                    </h4>
                    <p className="text-sm text-red-700 mt-1">
                      {selectedScan.error_message}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ✅ Modal des vulnérabilités améliorée pour utiliser les vraies données de la DB
  const VulnerabilitiesModal = () => {
    const [vulnerabilities, setVulnerabilities] = useState([]);
    const [loading, setLoading] = useState(false);
    const [groupBy, setGroupBy] = useState("severity");

    useEffect(() => {
      if (selectedVulnerabilities) {
        setLoading(true);
        apiService
          .getScanVulnerabilities(selectedVulnerabilities.id)
          .then((data) => {
            console.log("🛡️ Vulnérabilités reçues:", data);
            setVulnerabilities(data || []);
          })
          .catch((error) => {
            console.error("❌ Erreur récupération vulnérabilités:", error);
            addNotification(
              "Erreur lors du chargement des vulnérabilités",
              "error"
            );
          })
          .finally(() => setLoading(false));
      }
    }, [selectedVulnerabilities, addNotification]);

    if (!selectedVulnerabilities) return null;

    const groupedVulnerabilities =
      vulnerabilities.length > 0
        ? (() => {
            if (groupBy === "severity") {
              return vulnerabilities.reduce((acc, vuln) => {
                const severity = vuln.severity || "UNKNOWN";
                if (!acc[severity]) acc[severity] = [];
                acc[severity].push(vuln);
                return acc;
              }, {});
            } else if (groupBy === "package") {
              return vulnerabilities.reduce((acc, vuln) => {
                const pkg = vuln.package_name || "Unknown";
                if (!acc[pkg]) acc[pkg] = [];
                acc[pkg].push(vuln);
                return acc;
              }, {});
            }
            return { Toutes: vulnerabilities };
          })()
        : {};

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div
          className={`${theme.cardBg} rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col`}
        >
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Bug className="w-6 h-6 mr-3 text-red-600" />
                <div>
                  <h2 className={`text-xl font-bold ${theme.text}`}>
                    Vulnérabilités détaillées
                  </h2>
                  <p className={`${theme.textMuted}`}>
                    {selectedVulnerabilities.repository} -{" "}
                    {vulnerabilities.length} vulnérabilité
                    {vulnerabilities.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value)}
                  className={`px-3 py-2 ${theme.cardBg} ${theme.border} border rounded-lg ${theme.text} text-sm`}
                >
                  <option value="severity">Grouper par sévérité</option>
                  <option value="package">Grouper par package</option>
                  <option value="none">Sans groupement</option>
                </select>

                {vulnerabilities.length > 0 && (
                  <button
                    onClick={() =>
                      apiService.exportVulnerabilities(
                        selectedVulnerabilities.id
                      )
                    }
                    className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center text-sm"
                  >
                    <Download className="w-4 h-4 mr-1" />
                    CSV
                  </button>
                )}

                <button
                  onClick={() => setSelectedVulnerabilities(null)}
                  className={`${theme.textMuted} hover:text-gray-700 transition-colors`}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full"></div>
                <span className={`ml-3 ${theme.text}`}>
                  Chargement des vulnérabilités...
                </span>
              </div>
            ) : vulnerabilities.length === 0 ? (
              <div className="text-center py-12">
                <Shield className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <p className={`text-lg font-medium ${theme.text}`}>
                  Aucune vulnérabilité détectée
                </p>
                <p className={`${theme.textMuted}`}>
                  Ce dépôt semble sécurisé !
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedVulnerabilities).map(
                  ([groupName, vulns]) => (
                    <div key={groupName}>
                      <div className="flex items-center mb-4">
                        <h3
                          className={`text-lg font-semibold ${theme.text} flex items-center`}
                        >
                          {groupBy === "severity" && (
                            <div
                              className={`w-4 h-4 rounded ${getSeverityColor(
                                groupName
                              )} mr-2`}
                            ></div>
                          )}
                          {groupName}
                          <span
                            className={`ml-2 px-2 py-1 bg-gray-100 ${theme.textMuted} text-sm rounded-full`}
                          >
                            {vulns.length}
                          </span>
                        </h3>
                      </div>

                      <div className="grid gap-4">
                        {vulns.map((vuln, index) => (
                          <div
                            key={`${vuln.id}-${index}`}
                            className={`${
                              darkMode ? "bg-gray-700" : "bg-gray-50"
                            } p-4 rounded-lg border-l-4 ${getSeverityColor(
                              vuln.severity
                            )}`}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <h4
                                  className={`font-semibold ${theme.text} mb-1`}
                                >
                                  {vuln.title || vuln.vuln_id}
                                </h4>
                                <div className="flex items-center space-x-4 text-sm">
                                  <span
                                    className={`px-2 py-1 rounded text-white text-xs ${getSeverityColor(
                                      vuln.severity
                                    )}`}
                                  >
                                    {vuln.severity}
                                  </span>
                                  <span className={`${theme.textMuted}`}>
                                    📦 {vuln.package_name}
                                  </span>
                                  <span className={`${theme.textMuted}`}>
                                    🆔 {vuln.vuln_id}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <p
                              className={`${theme.text} text-sm mb-3 leading-relaxed`}
                            >
                              {vuln.description}
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                              <div>
                                <span
                                  className={`font-medium ${theme.textMuted}`}
                                >
                                  Version installée:
                                </span>
                                <div className={`${theme.text} font-mono`}>
                                  {vuln.version || "N/A"}
                                </div>
                              </div>
                              <div>
                                <span
                                  className={`font-medium ${theme.textMuted}`}
                                >
                                  Version corrigée:
                                </span>
                                <div className={`${theme.text} font-mono`}>
                                  {vuln.fixed_version || "N/A"}
                                </div>
                              </div>
                            </div>

                            {vuln.reference_links && (
                              <div className="mt-3 pt-3 border-t border-gray-200">
                                <span
                                  className={`font-medium ${theme.textMuted} text-xs`}
                                >
                                  Références:
                                </span>
                                <div className="mt-1">
                                  {(() => {
                                    try {
                                      const refs = Array.isArray(
                                        vuln.reference_links
                                      )
                                        ? vuln.reference_links
                                        : JSON.parse(vuln.reference_links);

                                      return refs.slice(0, 3).map((ref, i) => (
                                        <a
                                          key={i}
                                          href={ref}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-600 hover:underline text-xs mr-3"
                                        >
                                          {ref.length > 50
                                            ? `${ref.slice(0, 47)}...`
                                            : ref}
                                        </a>
                                      ));
                                    } catch {
                                      return (
                                        <span
                                          className={`text-xs ${theme.textMuted}`}
                                        >
                                          Références non disponibles
                                        </span>
                                      );
                                    }
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Rendu principal
  return (
    <div className={`min-h-screen ${theme.bg} transition-colors duration-300`}>
      {/* Header */}
      <header
        className={`${theme.cardBg} shadow-sm ${theme.border} border-b sticky top-0 z-40`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-4">
              <Shield className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className={`text-2xl font-bold ${theme.text}`}>
                  Security Scanner
                </h1>
                <p className={`text-sm ${theme.textMuted}`}>
                  Analyse de sécurité des dépôts GitHub
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {/* Statut de connexion */}
              <div
                className={`flex items-center px-3 py-1 rounded-full text-sm bg-green-100 text-green-800`}
              >
                <div className={`w-2 h-2 rounded-full mr-2 bg-green-500`}></div>
                Connecté
              </div>

              {/* Notifications */}
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`relative p-2 ${theme.cardBg} ${theme.border} border rounded-lg hover:bg-gray-50 transition-colors`}
              >
                <Bell className={`w-5 h-5 ${theme.text}`} />
                {notifications.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </button>

              {/* Toggle thème */}
              <button
                onClick={handleThemeToggle}
                className={`p-2 ${theme.cardBg} ${theme.border} border rounded-lg hover:bg-gray-50 transition-colors`}
              >
                {darkMode ? (
                  <Sun className="w-5 h-5 text-yellow-500" />
                ) : (
                  <Moon className="w-5 h-5 text-gray-600" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Contenu principal */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ✅ Statistiques améliorées */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Total des scans"
            value={stats.total_scans || 0}
            icon="📊"
            color="blue"
          />
          <StatCard
            title="Scans terminés"
            value={stats.completed_scans || 0}
            icon="✅"
            color="green"
          />
          <StatCard
            title="Vulnérabilités critiques"
            value={vulnStats.critical || 0}
            icon="🚨"
            color="red"
          />
          <StatCard
            title="En cours"
            value={stats.running_scans || 0}
            icon="⚡"
            color="yellow"
          />
        </div>

        {/* Formulaire de scan */}
        <div className="mb-8">
          <ScanForm />
        </div>

        {/* Scan en cours */}
        {currentScan && (
          <div className="mb-8">
            <CurrentScanStatus />
          </div>
        )}

        {/* Historique des scans */}
        <ScanHistoryTable />
      </main>

      {/* Modals et composants overlay */}
      <NotificationPanel />
      <ScanDetailsModal />
      <VulnerabilitiesModal />
    </div>
  );
}

export default App;
