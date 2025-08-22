# Étape 1 : Choisir Node.js
FROM node:18

# Étape 2 : Créer répertoire de travail
WORKDIR /app

# Étape 3 : Copier package.json et installer dépendances
COPY package*.json ./
RUN npm install --production

# Étape 4 : Copier le reste du code
COPY . .

# Étape 5 : Exposer le port du backend
EXPOSE 3001

# Étape 6 : Lancer le serveur
CMD ["node", "server.js"]
