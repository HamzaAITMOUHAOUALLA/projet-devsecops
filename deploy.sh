#!/bin/bash

# Script de déploiement complet Kubernetes + Argo CD
# Usage: ./deploy.sh <DOCKERHUB_USERNAME>

set -e

DOCKERHUB_USERNAME=${1:-"votre-username"}
GITHUB_REPO=${2:-"HamzaAITMOUHAOUALLA/projet-devsecops"}

if [ "$DOCKERHUB_USERNAME" = "votre-username" ]; then
    echo "❌ Erreur: Vous devez spécifier votre nom d'utilisateur Docker Hub"
    echo "Usage: ./deploy.sh <DOCKERHUB_USERNAME> [GITHUB_REPO]"
    echo "Exemple: ./deploy.sh hamza123"
    exit 1
fi

echo "🚀 Déploiement DevSecOps pour: $DOCKERHUB_USERNAME"
echo "📦 Repo GitHub: $GITHUB_REPO"

# Fonction pour vérifier si une commande existe
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Vérifier les prérequis
echo "🔍 Vérification des prérequis..."

if ! command_exists kubectl; then
    echo "❌ kubectl n'est pas installé"
    echo "📥 Téléchargez kubectl : https://kubernetes.io/docs/tasks/tools/"
    exit 1
fi

if ! command_exists k3d; then
    echo "❌ k3d n'est pas installé"
    echo "📥 Installation de k3d..."
    
    # Télécharger k3d pour Windows
    if [[ "$OSTYPE" == "msys" ]]; then
        curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash
    else
        echo "📥 Téléchargez k3d : https://k3d.io/v5.4.6/#installation"
        exit 1
    fi
fi

if ! command_exists docker; then
    echo "❌ Docker n'est pas installé ou n'est pas démarré"
    echo "📥 Assurez-vous que Docker Desktop est lancé"
    exit 1
fi

echo "✅ Prérequis OK"

# Créer/démarrer le cluster k3d
echo "🏗️  Création du cluster Kubernetes..."
if k3d cluster list | grep -q devsecops; then
    echo "📝 Cluster 'devsecops' existe déjà"
    k3d cluster start devsecops || k3d cluster delete devsecops
fi

if ! k3d cluster list | grep -q devsecops; then
    k3d cluster create devsecops \
        --agents 1 \
        --port "80:80@loadbalancer" \
        --port "443:443@loadbalancer" \
        --port "8080:8080@loadbalancer" \
        --wait
fi

# Attendre que le cluster soit prêt
echo "⏳ Attente que le cluster soit prêt..."
kubectl wait --for=condition=Ready nodes --all --timeout=300s

# Installer Argo CD
echo "🔄 Installation d'Argo CD..."
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Attendre que Argo CD soit prêt
echo "⏳ Attente qu'Argo CD soit prêt..."
kubectl wait --for=condition=available --timeout=600s deployment/argocd-server -n argocd

# Créer l'application Argo CD
echo "📱 Création de l'application Argo CD..."
cat > argocd-app.yaml << EOL
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: devsecops-app
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://github.com/$GITHUB_REPO.git
    targetRevision: main
    path: k8s
  destination:
    server: https://kubernetes.default.svc
    namespace: devsecops
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
      - PruneLast=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
EOL

kubectl apply -f argocd-app.yaml

# Déployer les manifests directement
echo "📦 Déploiement des manifests Kubernetes..."
if [ -d "k8s" ]; then
    kubectl apply -f k8s/
else
    echo "⚠️ Dossier k8s/ non trouvé. Exécutez d'abord ./create-k8s-manifests.sh"
fi

# Attendre un peu pour les déploiements
echo "⏳ Attente des déploiements..."
sleep 30

# Afficher l'état
echo "📊 État du cluster:"
kubectl get pods -n devsecops
kubectl get svc -n devsecops

# Obtenir le mot de passe Argo CD
echo "🔐 Récupération du mot de passe Argo CD..."
sleep 10  # Attendre que le secret soit créé
ARGOCD_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" 2>/dev/null | base64 -d 2>/dev/null || echo "Pas encore disponible")

# Instructions finales
echo ""
echo "🎉 Déploiement terminé !"
echo ""
echo "📋 Informations de connexion:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌐 Argo CD UI:"
echo "   1. Dans un nouveau terminal Git Bash:"
echo "      kubectl port-forward svc/argocd-server -n argocd 8080:443"
echo "   2. Ouvrir: https://localhost:8080"
echo "   3. User: admin"
if [ "$ARGOCD_PASSWORD" != "Pas encore disponible" ]; then
    echo "   4. Password: $ARGOCD_PASSWORD"
else
    echo "   4. Password: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath=\"{.data.password}\" | base64 -d"
fi
echo ""
echo "⚛️  Dashboard de l'application:"
echo "   1. Dans un nouveau terminal Git Bash:"
echo "      kubectl port-forward svc/dashboard -n devsecops 8081:80"
echo "   2. Ouvrir: http://localhost:8081"
echo ""
echo "🔧 Backend API:"
echo "   1. Dans un nouveau terminal Git Bash:"
echo "      kubectl port-forward svc/backend -n devsecops 3001:3001"
echo "   2. Ouvrir: http://localhost:3001/healthz"
echo ""
echo "📝 Commandes utiles:"
echo "   kubectl get pods -n devsecops                    # Voir les pods"
echo "   kubectl logs -f deployment/backend -n devsecops     # Logs backend"
echo "   kubectl logs -f deployment/dashboard -n devsecops   # Logs dashboard"
echo "   kubectl delete -f k8s/                           # Supprimer l'app"
echo "   k3d cluster delete devsecops                     # Supprimer le cluster"
echo ""
echo "🚀 Prochaines étapes:"
echo "1. Configurez vos secrets GitHub (DOCKERHUB_USERNAME et DOCKERHUB_TOKEN)"
echo "2. Pushez votre code pour déclencher le build des images Docker"
echo "3. Argo CD synchronisera automatiquement les changements"
echo ""

# Sauvegarder les informations dans un fichier
cat > deployment-info.txt << EOL
Informations de déploiement DevSecOps
=====================================

Docker Hub: $DOCKERHUB_USERNAME
GitHub Repo: $GITHUB_REPO
Cluster: k3d devsecops

Argo CD:
- URL: https://localhost:8080 
- Terminal: kubectl port-forward svc/argocd-server -n argocd 8080:443
- User: admin
- Password: $ARGOCD_PASSWORD

Application:
- Dashboard: http://localhost:8081 
- Terminal: kubectl port-forward svc/dashboard -n devsecops 8081:80
- Backend: http://localhost:3001
- Terminal: kubectl port-forward svc/backend -n devsecops 3001:3001

Commandes utiles:
- kubectl get pods -n devsecops
- kubectl logs -f deployment/backend -n devsecops
- kubectl logs -f deployment/dashboard -n devsecops
- k3d cluster delete devsecops  (pour tout supprimer)
EOL

echo "💾 Informations sauvegardées dans deployment-info.txt"
echo ""
echo "🔗 Pour accéder aux services, ouvrez 3 terminaux Git Bash supplémentaires et lancez les port-forward ci-dessus"
