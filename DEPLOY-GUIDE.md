# ساس — دليل النشر الكامل

## 🏗 المعمارية: Hybrid

```
┌─────────────────────────┐     ┌──────────────────────────┐
│   Vercel (Frontend)     │     │   Railway (Backend)      │
│                         │     │                          │
│  Next.js 14 + Tailwind  │────▶│  Express + PostgreSQL    │
│  Dashboard + Storefront │     │  REST API + JWT Auth     │
│  SSR + Edge             │     │  Payment + Shipping      │
│                         │     │                          │
│  saas.qa                │     │  api.saas.qa             │
└─────────────────────────┘     └──────────────────────────┘
```

---

## ١. Railway — Backend (أول شيء)

### الخطوات:

#### 1. أنشئ حساب Railway
- افتح [railway.app](https://railway.app)
- سجّل بحساب GitHub

#### 2. أنشئ مشروع جديد
- اضغط **New Project**
- اختر **Deploy from GitHub repo**
- ارفع مجلد `saas-backend` على GitHub أولاً

#### 3. أضف PostgreSQL
- من داخل المشروع اضغط **+ New**
- اختر **Database → PostgreSQL**
- Railway يعطيك `DATABASE_URL` تلقائياً ✅

#### 4. اربط المتغيرات
في **Settings → Variables** أضف:

```
PORT=4000
NODE_ENV=production
FRONTEND_URL=https://your-app.vercel.app
JWT_SECRET=اكتب-كلمة-سر-طويلة-وعشوائية-هنا
```

> ⚠️ `DATABASE_URL` يتضاف تلقائي من Railway PostgreSQL

#### 5. شغّل الـ Migration
من تبويب **Settings → Deploy**:
- بعد ما ينشر، افتح **Railway Shell** (أو من الكمبيوتر):

```bash
npm run db:migrate
npm run db:seed
```

#### 6. تأكد إنه شغّال
```
https://your-backend.railway.app/api/health
```
لازم يرجع: `{ "status": "ok", "database": { "status": "connected" } }`

#### 7. انسخ الرابط
مثال: `https://saas-backend-production.up.railway.app`

---

## ٢. Vercel — Frontend

### الخطوات:

#### 1. ارفع مجلد `saas-frontend` على GitHub

#### 2. افتح [vercel.com](https://vercel.com)
- سجّل بحساب GitHub
- اضغط **Add New → Project**
- اختر الـ repo حق `saas-frontend`

#### 3. أضف متغيرات البيئة
في **Settings → Environment Variables**:

```
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
NEXT_PUBLIC_APP_NAME=ساس
NEXT_PUBLIC_STORE_DOMAIN=saas.qa
```

#### 4. انشر
- Vercel يبني وينشر تلقائي ✅
- يعطيك رابط مثل: `https://saas-frontend.vercel.app`

#### 5. ارجع لـ Railway وحدّث
```
FRONTEND_URL=https://saas-frontend.vercel.app
```

---

## ٣. ربط الدومين (اختياري)

### Vercel (الموقع الرئيسي):
- **Settings → Domains** → أضف `saas.qa` و `*.saas.qa`
- غيّر DNS عند مزود الدومين

### Railway (الـ API):
- **Settings → Networking → Custom Domain** → أضف `api.saas.qa`

---

## ٤. التكلفة المتوقعة

| الخدمة | المجاني | المدفوع |
|--------|---------|---------|
| **Vercel** | 100GB bandwidth | $20/شهر (Pro) |
| **Railway** | $5 credits/شهر | $5-20/شهر حسب الاستخدام |
| **PostgreSQL** | مدمج مع Railway | ← |
| **المجموع** | ~$0 (MVP) | **$5-25/شهر** |

---

## ٥. بيانات التجربة

بعد تشغيل `npm run db:seed`:

```
📧 البريد:    admin@saas.qa
🔑 كلمة المرور: password123
🏪 المتجر:    demo-store.saas.qa
```

---

## ٦. أوامر مفيدة

```bash
# Backend (Railway)
npm run dev          # تشغيل محلي على port 4000
npm run db:migrate   # تطبيق Schema
npm run db:seed      # بيانات تجريبية

# Frontend (Vercel)
npm run dev          # تشغيل محلي على port 3000
npm run build        # بناء للنشر
```

## ٧. الخطوة التالية

المحادثة ٢: **نظام المصادقة + تسجيل التاجر**
- JWT token system كامل
- صفحة تسجيل تعمل فعلياً
- إنشاء المتجر تلقائياً مع subdomain

---

**ساس** — ابدأ البيع بثبات 🚀
