# 🔒 DevSecOps Security Scanning Platform For Your App Code ...

 A **DevSecOps web platform** that allows users to submit a **GitHub repository URL** and receive **real-time security scan results** in a dashboard.  
The scanning is performed by **GitHub Actions** using **Snyk** for dependency, code, and container security analysis.
This is a project realised by AIT MOUHA OUALLA HAMZA and BAYCHOU BRAHIM (Students at ENSAS School) in collaboration with TASMIM WEB Startup.

## 📌 Features

- **User-friendly dashboard** to track scans.
- **Manual scan trigger** via repository URL input.
- **Automatic detection** of project type:
  - Node.js
  - Python
  - PHP
  - Docker
- **Multiple Snyk scans**:
  - Dependency vulnerabilities
  - Code security
  - Container image vulnerabilities
- **Real-time status updates** (`running`, `completed`, `failed`).
- **Detailed JSON results** and severity summary (critical, high, medium, low).
- **API integration** between platform and GitHub Actions.

---

## 🏗️ Architecture
[ User ] → [ Platform Frontend ] → [ Platform Backend ]
↑ │
│ ↓
[ Dashboard ] ← [ API /api/scan/results ] ← [ GitHub Actions Workflow ]

---

**Flow:**
1. User enters a GitHub repo URL in the frontend.
2. Backend generates a unique `scan_id` and triggers the GitHub Actions workflow.
3. Workflow:
   - Clones the repository.
   - Detects the project type.
   - Runs Snyk scans.
   - Sends results back to the platform API.
4. Backend stores results in the database.
5. Frontend dashboard displays the results in real time.

---

## ⚙️ Technology Stack

- **Frontend:** ReactJS
- **Backend:** Node.js / Python
- **CI/CD:** GitHub Actions
- **Security Scanning:** Snyk
- **Database:** PostgreSQL / MongoDB (didn't decide yet ...)
- **Hosting:** Any cloud platform (AWS, Azure, GCP, etc.) (if we deployed the dasbhoard...)

---

