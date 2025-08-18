#!/bin/bash

# Script pour créer tous les manifests Kubernetes
# Usage: ./create-k8s-manifests.sh <DOCKERHUB_USERNAME>

set -e

DOCKERHUB_USERNAME=${1:-"votre-username"}

if [ "$DOCKERHUB_USERNAME" = "votre-username" ]; then
    echo "❌ Erreur: Vous devez spécifier votre nom d'utilisateur Docker Hub"
    echo "Usage: ./create-k8s-manifests.sh <DOCKERHUB_USERNAME>"
    echo "Exemple: ./create-k8s-manifests.sh hamza123"
    exit 1
fi

echo "🚀 Création des manifests Kubernetes pour: $DOCKERHUB_USERNAME"

# Créer le dossier k8s s'il n'existe pas
mkdir -p k8s

echo "📁 Création du namespace..."
cat > k8s/namespace.yaml << EOL
apiVersion: v1
kind: Namespace
metadata:
  name: devsecops
EOL

echo "🔧 Création du déploiement backend..."
cat > k8s/backend-deploy.yaml << EOL
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: devsecops
  labels:
    app: backend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: $DOCKERHUB_USERNAME/backend:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 3001
              name: http
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "3001"
          readinessProbe:
            httpGet:
              path: /healthz
              port: 3001
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3001
            initialDelaySeconds: 15
            periodSeconds: 20
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "200m"
EOL

echo "🌐 Création du service backend..."
cat > k8s/backend-svc.yaml << EOL
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: devsecops
  labels:
    app: backend
spec:
  selector:
    app: backend
  ports:
    - port: 3001
      targetPort: 3001
      protocol: TCP
      name: http
  type: ClusterIP
EOL

echo "⚛️  Création du déploiement dashboard..."
cat > k8s/dashboard-deploy.yaml << EOL
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dashboard
  namespace: devsecops
  labels:
    app: dashboard
spec:
  replicas: 1
  selector:
    matchLabels:
      app: dashboard
  template:
    metadata:
      labels:
        app: dashboard
    spec:
      containers:
        - name: dashboard
          image: $DOCKERHUB_USERNAME/dashboard:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 80
              name: http
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "100m"
EOL

echo "🌍 Création du service dashboard..."
cat > k8s/dashboard-svc.yaml << EOL
apiVersion: v1
kind: Service
metadata:
  name: dashboard
  namespace: devsecops
  labels:
    app: dashboard
spec:
  selector:
    app: dashboard
  ports:
    - port: 80
      targetPort: 80
      protocol: TCP
      name: http
  type: ClusterIP
EOL

echo "✅ Tous les manifests ont été créés dans le dossier k8s/"
echo ""
echo "📁 Fichiers créés:"
echo "  - k8s/namespace.yaml"
echo "  - k8s/backend-deploy.yaml"
echo "  - k8s/backend-svc.yaml"
echo "  - k8s/dashboard-deploy.yaml"
echo "  - k8s/dashboard-svc.yaml"
echo ""
echo "🚀 Prochaines étapes:"
echo "1. Vérifiez les fichiers générés"
echo "2. Committez: git add k8s/ && git commit -m 'feat: add k8s manifests'"
echo "3. Déployez: kubectl apply -f k8s/"
