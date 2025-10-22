# InvoSmart - Smart Invoice Assistant

> Aplikasi web untuk freelancer dan bisnis kecil yang membuat, mengelola, dan menganalisis invoice secara otomatis dengan bantuan AI.

---

## 💡 Tentang InvoSmart

**InvoSmart** adalah solusi invoice management yang dirancang khusus untuk freelancer dan bisnis kecil. Dengan bantuan AI, pengguna dapat membuat invoice profesional hanya dengan mengetik perintah alami seperti:

> *"Buat invoice untuk proyek desain website senilai Rp 3.500.000 untuk PT Andromeda."*

Sistem akan secara otomatis menghasilkan invoice lengkap dalam format profesional (PDF/HTML) yang siap dikirim ke klien via email.

---

## 🎯 Konsep & Tujuan

InvoSmart bertujuan untuk:

- **Mempercepat** proses pembuatan invoice dengan AI natural language processing
- **Mengotomasi** pengelolaan invoice (tracking pembayaran, reminder, analitik)
- **Meningkatkan profesionalitas** dengan template invoice yang modern dan customizable
- **Memberikan insight** bisnis melalui analisis AI terhadap pola pembayaran dan pendapatan

---

## ⚙️ Fitur Utama

### 🎯 MVP (Minimum Viable Product)

Fitur inti yang akan dikembangkan dalam 3-4 minggu pertama:

#### 1. Autentikasi & Otorisasi
- Login & Register via email/password
- Integrasi Google OAuth untuk sign-in cepat
- Session management dengan JWT

#### 2. Dashboard Invoice
- Daftar lengkap semua invoice pengguna
- Filter berdasarkan status: **Paid** / **Unpaid** / **Draft**
- Quick stats: total pendapatan, invoice pending, dll.

#### 3. AI Invoice Generator
- **Input**: Teks perintah natural language
  - Contoh: *"buat invoice 2 juta untuk desain logo klien ABC"*
- **Proses**: AI parsing dengan OpenAI GPT-4 API
- **Output**: Form invoice terisi otomatis (klien, item, harga, tanggal, pajak, total)

#### 4. Manual Invoice Form
- Alternatif pembuatan invoice tanpa AI
- Form lengkap dengan validasi
- Auto-calculation untuk subtotal, pajak, dan total

#### 5. Export ke PDF
- Template profesional dan clean
- Support custom branding (logo, warna, font)
- Download atau preview sebelum kirim

#### 6. Manajemen Status Invoice
- Update status: **Draft** → **Sent** → **Paid** / **Unpaid**
- Timestamp otomatis untuk setiap perubahan status
- Reminder untuk invoice overdue

---

### 🚀 Fitur Lanjutan (Future Development)

Fitur tambahan untuk membuat aplikasi lebih powerful:

#### 1. AI Chat Assistant
Conversational AI untuk query bisnis:
- *"Klien mana yang belum bayar bulan ini?"*
- *"Total invoice bulan ini berapa?"*
- *"Berapa rata-rata waktu pembayaran klien?"*

#### 2. AI Analytics & Insights
- **Dashboard Analytics**:
  - Grafik pemasukan bulanan/tahunan
  - Breakdown per klien dan per kategori layanan
  - Perbandingan periode (MoM, YoY)
  
- **AI-Generated Insights**:
  - *"Pendapatan kamu naik 15% dibanding bulan lalu"*
  - *"Klien X selalu bayar tepat waktu, pertimbangkan untuk partnership jangka panjang"*
  - *"Ada 3 invoice overdue total Rp 5.2 juta, pertimbangkan kirim reminder"*

#### 3. Email Automation
- Kirim invoice langsung ke email klien
- Template email customizable
- Auto-reminder untuk invoice unpaid
- CC/BCC support

#### 4. Payment Integration
- Integrasi dengan Stripe (internasional)
- Integrasi dengan Midtrans (Indonesia)
- Sandbox mode untuk testing
- Payment tracking otomatis

#### 5. Multi-template Invoice
- Berbagai pilihan desain template
- Custom branding (logo, color scheme, typography)
- Preview real-time sebelum finalize

#### 6. Client Management
- Database klien dengan contact details
- Riwayat invoice per klien
- Notes dan tags untuk kategorisasi

#### 7. Recurring Invoices
- Setup invoice berulang (weekly, monthly, yearly)
- Auto-generate dan auto-send
- Manage subscription-based billing

---

## 🧱 Arsitektur & Stack Teknologi

### Tech Stack

| Komponen | Teknologi Utama | Alternatif |
|----------|----------------|------------|
| **Frontend** | React.js / Next.js | Vue.js, Svelte |
| **Backend** | Node.js + Express | FastAPI (Python) |
| **Database** | MongoDB | PostgreSQL |
| **AI Layer** | OpenAI GPT-4 API | Google Gemini, Anthropic Claude |
| **Authentication** | Firebase Auth / JWT | Auth0, Supabase Auth |
| **PDF Generator** | pdfmake / Puppeteer | jsPDF, PDFKit |
| **Charts** | Chart.js / Recharts | D3.js, ApexCharts |
| **Email Service** | Nodemailer + SendGrid | Resend, Mailgun |
| **Hosting** | Vercel + Render + MongoDB Atlas | Railway, Supabase, AWS |

### Dependency Management
```json
{
  "frontend": {
    "core": ["react", "next", "typescript"],
    "ui": ["tailwindcss", "shadcn-ui", "lucide-react"],
    "state": ["zustand", "react-query"],
    "forms": ["react-hook-form", "zod"]
  },
  "backend": {
    "core": ["express", "typescript", "dotenv"],
    "database": ["mongoose", "mongodb"],
    "auth": ["jsonwebtoken", "bcrypt", "passport"],
    "ai": ["openai"],
    "pdf": ["puppeteer", "pdfmake"],
    "email": ["nodemailer", "@sendgrid/mail"]
  }
}
```

---

## 🧩 Arsitektur Sistem
```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend Layer                          │
│                  (React.js / Next.js)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │Dashboard │  │ AI Chat  │  │ Invoice  │  │Analytics │   │
│  │          │  │Assistant │  │  Form    │  │          │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTPS/REST API
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway Layer                         │
│                   (Express.js + JWT)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Route Controllers                                    │  │
│  │  ├── /auth      (login, register, verify)            │  │
│  │  ├── /invoices  (CRUD operations)                    │  │
│  │  ├── /ai        (natural language processing)        │  │
│  │  ├── /clients   (client management)                  │  │
│  │  └── /analytics (data insights)                      │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐  ┌─────────────┐  ┌──────────────┐
│  AI Service  │  │  Database   │  │ External API │
│   Layer      │  │   Layer     │  │   Services   │
├──────────────┤  ├─────────────┤  ├──────────────┤
│ OpenAI API   │  │  MongoDB    │  │  SendGrid    │
│ - Parse text │  │             │  │  (Email)     │
│ - Generate   │  │ Collections:│  │              │
│   content    │  │ ├─users     │  │  Stripe/     │
│ - Analytics  │  │ ├─invoices  │  │  Midtrans    │
│ - Insights   │  │ ├─clients   │  │  (Payment)   │
│              │  │ └─analytics │  │              │
└──────────────┘  └─────────────┘  └──────────────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
           ┌──────────────────────────┐
           │  Utility Services        │
           ├──────────────────────────┤
           │ - PDF Generator          │
           │ - Email Templates        │
           │ - File Storage           │
           │ - Logging & Monitoring   │
           └──────────────────────────┘
```

### Data Flow Example: AI Invoice Generation
```
User Input → Frontend → API Gateway → AI Service
    ↓
OpenAI processes natural language
    ↓
Structured data returned → Backend validates → Save to MongoDB
    ↓
Return invoice data → Frontend displays preview → User confirms
    ↓
Generate PDF → Store/Send → Update invoice status
```

---

## 🎨 Konsep UI/UX

### 1. Dashboard Utama

**Layout**: Sidebar navigation + Main content area

**Sidebar (Left)**:
- 🏠 Dashboard
- 📄 Invoices
- 👥 Clients
- 📊 Analytics
- ⚙️ Settings
- 👤 Profile

**Main Content**:
- **Stats Cards** (top):
  - Total Revenue (bulan ini)
  - Pending Invoices
  - Paid Invoices
  - Overdue Amount
  
- **Quick Actions**:
  - ✨ **Generate Invoice with AI** (prominent CTA button)
  - ➕ Create Manual Invoice
  
- **Recent Invoices Table**:
  - Columns: Invoice #, Client, Date, Amount, Status, Actions
  - Status badges: 🟢 Paid | 🟡 Pending | 🔴 Overdue
  - Quick actions: View, Edit, Download, Send

### 2. AI Assistant Page

**Layout**: Chat-based interface

**Main Components**:
- **Chat Input** (bottom):
  - Large text area dengan placeholder: "Try: Create invoice for web design project, $2000 for ABC Corp"
  - Suggested prompts/quick actions
  
- **Conversation Area**:
  - User messages (right-aligned)
  - AI responses (left-aligned) dengan:
    - Structured invoice preview
    - Confirm/Edit buttons
    - "Generate Invoice" CTA

**Example Interaction**:
```
User: "buat invoice 3.5 juta untuk desain website PT Andromeda"

AI Response:
✓ Invoice telah saya siapkan:
┌─────────────────────────────┐
│ Client: PT Andromeda        │
│ Service: Desain Website     │
│ Amount: Rp 3.500.000        │
│ Date: 22 Okt 2025           │
│ Due Date: 22 Nov 2025       │
└─────────────────────────────┘

[Edit Details] [Confirm & Generate]
```

### 3. Create/Edit Invoice Page

**Layout**: Two-column form

**Left Column** (Sender & Recipient):
- Your business info (auto-filled from profile)
- Client selection (dropdown + "Add New Client")
- Invoice date & due date pickers
- Invoice number (auto-generated, editable)

**Right Column** (Items & Calculation):
- **Line Items**:
  - Description, Quantity, Rate, Amount
  - [+ Add Item] button
- **Calculations** (auto-calculated):
  - Subtotal
  - Tax (%) → Amount
  - Discount (%) → Amount
  - **Total** (highlighted)
  
**Actions Bar** (bottom):
- Save as Draft
- 💾 Download PDF
- 📧 Send via Email
- Cancel

**Preview Panel** (optional toggle):
- Live preview of PDF output

### 4. Analytics Dashboard

**Layout**: Grid-based dashboard

**Top Section**:
- Date range selector (This Month, Last 3 Months, This Year, Custom)
- Export button (CSV, PDF)

**Charts & Visualizations**:
- **Revenue Chart** (line/bar):
  - Monthly breakdown
  - Comparison dengan periode sebelumnya
  
- **Invoice Status Distribution** (donut chart):
  - Paid vs Unpaid vs Overdue
  
- **Top Clients** (horizontal bar chart):
  - Sorted by total revenue
  
- **Payment Timeline** (calendar heatmap):
  - Visualisasi pola pembayaran

**AI Insights Card**:
```
🤖 AI Insights
─────────────────────────────────
✓ Total unpaid invoices: Rp 8.200.000
⚠ 3 invoices are overdue (send reminder?)
📈 Revenue up 15% vs last month
💡 Client "PT XYZ" consistently pays on time
   - Consider offering them loyalty discount
```

### 5. Client Management Page

**Layout**: List/Grid view toggle

**Table View**:
- Client Name, Contact, Total Invoices, Total Revenue, Status
- Quick filters: Active, All, Archived

**Detail View** (modal/side panel):
- Contact information
- Invoice history with this client
- Payment patterns (avg days to pay)
- Notes section
- Quick action: "Create Invoice for This Client"

---

## 🗓️ Roadmap Pengembangan

### **Minggu 1: Design & Setup**
**Deliverables**:
- ✅ Wireframes dan mockups di Figma
- ✅ Setup repository GitHub (dengan branch strategy)
- ✅ Initialize frontend (Next.js + TypeScript)
- ✅ Initialize backend (Express + MongoDB)
- ✅ Setup environment variables dan configs
- ✅ Define database schemas (User, Invoice, Client)

**Tech Tasks**:
```bash
# Frontend
npx create-next-app@latest invosmart --typescript --tailwind --app
cd invosmart && npm install

# Backend
mkdir invosmart-api && cd invosmart-api
npm init -y
npm install express mongoose dotenv cors jsonwebtoken bcrypt
```

---

### **Minggu 2: Auth & CRUD Invoice**
**Deliverables**:
- ✅ User authentication (register, login, JWT)
- ✅ Protected routes dengan middleware
- ✅ CRUD operations untuk invoice manual
- ✅ Basic dashboard dengan invoice list
- ✅ Invoice status management (Draft → Sent → Paid)

**Features**:
- Login/Register form dengan validasi
- Dashboard layout dengan sidebar
- Create invoice form (manual input)
- Edit/Delete invoice functionality
- Basic filtering (All, Paid, Unpaid, Draft)

**API Endpoints**:
```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/invoices
POST   /api/invoices
GET    /api/invoices/:id
PUT    /api/invoices/:id
DELETE /api/invoices/:id
PATCH  /api/invoices/:id/status
```

---

### **Minggu 3: AI Integration & PDF Export**
**Deliverables**:
- ✅ OpenAI API integration
- ✅ AI natural language parser untuk invoice
- ✅ AI chat interface
- ✅ PDF generation dengan template profesional
- ✅ Download PDF functionality

**Features**:
- AI Assistant page dengan chat interface
- Natural language invoice creation
- Preview sebelum confirm
- PDF template dengan custom branding
- Multiple PDF template options

**AI Prompt Engineering**:
```javascript
const systemPrompt = `
You are an invoice assistant. Parse user input and extract:
- Client name
- Service/product description
- Amount/price
- Date (if mentioned, else use today)
- Currency (default IDR)

Return structured JSON.
`;
```

**API Endpoints**:
```
POST /api/ai/parse-invoice
POST /api/invoices/:id/generate-pdf
GET  /api/invoices/:id/download-pdf
```

---

### **Minggu 4: Analytics & Deployment**
**Deliverables**:
- ✅ Analytics dashboard dengan charts
- ✅ Basic AI insights generation
- ✅ Deploy frontend ke Vercel
- ✅ Deploy backend ke Render
- ✅ MongoDB Atlas setup
- ✅ Environment variables configuration

**Features**:
- Revenue charts (monthly breakdown)
- Invoice status distribution
- Top clients ranking
- AI-generated business insights
- Responsive design polish

**Deployment Checklist**:
- [ ] Frontend build optimization
- [ ] Backend API documentation
- [ ] Database backup strategy
- [ ] SSL certificates
- [ ] Environment variables secured
- [ ] Error tracking (Sentry)
- [ ] Performance monitoring

---

### **Minggu 5: Email Automation & Chat Enhancement**
**Deliverables**:
- ✅ Email sending functionality (SendGrid/Nodemailer)
- ✅ Email templates untuk invoice
- ✅ Enhanced AI chat dengan context memory
- ✅ Query analytics via chat
- ✅ Payment reminder automation

**Features**:
- "Send Invoice" button dengan email preview
- Customizable email templates
- AI chat dapat query database:
  - *"Siapa klien dengan total invoice terbesar?"*
  - *"Berapa invoice yang belum dibayar bulan ini?"*
- Auto-reminder untuk overdue invoices

**API Endpoints**:
```
POST /api/invoices/:id/send-email
POST /api/ai/chat
GET  /api/analytics/query
POST /api/reminders/send
```

---

### **Minggu 6: Polish & Launch**
**Deliverables**:
- ✅ UI/UX refinement
- ✅ Bug fixes dan testing
- ✅ Documentation (README, API docs)
- ✅ Demo video recording
- ✅ GitHub repository polish
- ✅ Portfolio showcase preparation

**Final Tasks**:
- [ ] Comprehensive testing (unit, integration, E2E)
- [ ] Performance optimization
- [ ] Accessibility audit (WCAG compliance)
- [ ] SEO optimization
- [ ] Create demo accounts dengan sample data
- [ ] Record video walkthrough
- [ ] Write detailed README dengan screenshots
- [ ] Prepare case study untuk portfolio

**Launch Checklist**:
- [ ] Domain registration (optional)
- [ ] Google Analytics setup
- [ ] Social media assets (screenshots, GIFs)
- [ ] Product Hunt submission (optional)
- [ ] LinkedIn/Twitter announcement
- [ ] Add to portfolio website

---

## 📁 Struktur Project

### Frontend (Next.js)
```
invosmart/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── register/
│   ├── dashboard/
│   ├── invoices/
│   │   ├── new/
│   │   ├── [id]/
│   │   └── ai/
│   ├── clients/
│   ├── analytics/
│   └── settings/
├── components/
│   ├── ui/            # shadcn components
│   ├── layout/
│   ├── forms/
│   └── charts/
├── lib/
│   ├── api.ts         # API client
│   ├── utils.ts
│   └── validations.ts # Zod schemas
├── hooks/
├── public/
└── styles/
```

### Backend (Express)
```
invosmart-api/
├── src/
│   ├── config/
│   │   ├── db.ts
│   │   └── env.ts
│   ├── models/
│   │   ├── User.ts
│   │   ├── Invoice.ts
│   │   └── Client.ts
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── invoices.ts
│   │   ├── ai.ts
│   │   └── analytics.ts
│   ├── controllers/
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── errorHandler.ts
│   ├── services/
│   │   ├── ai.service.ts
│   │   ├── pdf.service.ts
│   │   └── email.service.ts
│   └── utils/
├── tests/
└── server.ts
```

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ dan npm/yarn
- MongoDB (local atau Atlas)
- OpenAI API key
- SendGrid API key (untuk email)

### Installation

1. **Clone repository**
```bash
git clone https://github.com/yourusername/invosmart.git
cd invosmart
```

2. **Setup Frontend**
```bash
cd frontend
npm install
cp .env.example .env.local
# Edit .env.local dengan API URLs
npm run dev
```

3. **Setup Backend**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env dengan credentials
npm run dev
```

4. **Environment Variables**

**Frontend (.env.local)**:
```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Backend (.env)**:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/invosmart
JWT_SECRET=your_jwt_secret_here
OPENAI_API_KEY=sk-...
SENDGRID_API_KEY=SG...
```

---

## 📖 API Documentation

### Authentication

**Register**
```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securePassword123"
}
```

**Login**
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "securePassword123"
}

Response:
{
  "token": "eyJhbGc...",
  "user": { ... }
}
```

### Invoices

**Create Invoice with AI**
```http
POST /api/ai/parse-invoice
Authorization: Bearer {token}
Content-Type: application/json

{
  "prompt": "buat invoice 3.5 juta untuk desain website PT Andromeda"
}

Response:
{
  "invoice": {
    "client": "PT Andromeda",
    "items": [
      {
        "description": "Desain Website",
        "quantity": 1,
        "rate": 3500000,
        "amount": 3500000
      }
    ],
    "subtotal": 3500000,
    "total": 3500000,
    "currency": "IDR"
  }
}
```

**Get All Invoices**
```http
GET /api/invoices?status=paid&page=1&limit=10
Authorization: Bearer {token}
```

**Generate PDF**
```http
POST /api/invoices/:id/generate-pdf
Authorization: Bearer {token}

Response: PDF file (binary)
```

---

## 🧪 Testing Strategy

### Unit Tests
- Model validations
- Utility functions
- AI parsing logic

### Integration Tests
- API endpoints
- Database operations
- Authentication flow

### E2E Tests (Playwright/Cypress)
- User registration & login
- Invoice creation workflow
- AI assistant interaction
- PDF generation and download

---

## 🎯 Success Metrics

### Technical Metrics
- ⚡ Page load time < 2s
- 📱 Mobile responsive (100% screens)
- ♿ Accessibility score > 90 (Lighthouse)
- 🐛 Zero critical bugs in production
- ✅ Test coverage > 80%

### Business Metrics
- 📈 User retention rate
- 💰 Average invoices per user
- ⏱️ Time saved vs manual process
- 😊 User satisfaction score (feedback)

---

## 🔐 Security Considerations

- ✅ JWT dengan expiration time
- ✅ Password hashing dengan bcrypt (salt rounds: 10)
- ✅ Input validation & sanitization (Zod)
- ✅ Rate limiting pada API endpoints
- ✅ CORS configuration
- ✅ Environment variables untuk secrets
- ✅ HTTPS only in production
- ✅ SQL injection prevention (mongoose)
- ✅ XSS protection (React escaping)

---

## 📝 Future Enhancements

### Phase 2 (Setelah MVP)
- 📱 Mobile app (React Native)
- 🌍 Multi-language support (i18n)
- 💸 Multi-currency support
- 🔗 API untuk integrasi third-party
- 📊 Advanced reporting (custom reports)
- 🤝 Team collaboration features
- 📦 Inventory management integration

### Phase 3 (Long-term)
- 🧾 Expense tracking
- 💼 Project management integration
- 🤖 Predictive analytics (ML models)
- 📱 WhatsApp/Telegram notifications
- 🌐 Marketplace untuk freelancers
- 🎓 Educational resources & tutorials

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) first.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 👨‍💻 Author

**Noah Is Me**
- Portfolio: [noahisme.vercel.app.com](https://noahisme.vercel.app.com)
- LinkedIn: [linkedin.com/in/yourprofile](https://linkedin.com/in/noorwahid)
- GitHub: [@yourusername](https://github.com/noah-isme)

---

## 🙏 Acknowledgments

- OpenAI untuk GPT-4 API
- Vercel untuk hosting platform
- MongoDB Atlas untuk database
- shadcn/ui untuk component library
- Komunitas open-source

---

## 📞 Support

Jika ada pertanyaan atau issues, silakan:
- 🐛 Open an issue di GitHub
- 📧 Email: your.email@example.com
- 💬 Join Discord community: [invite-link]

---

**⭐ Jangan lupa star repository ini jika bermanfaat!**

---

<div align="center">
  <strong>Built with ❤️ for freelancers and small businesses</strong>
</div>
