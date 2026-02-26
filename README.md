<div align="center">

# ساس — Backend API

**Express.js + PostgreSQL على Railway**

[![Railway](https://img.shields.io/badge/Railway-0B0D0E?logo=railway&logoColor=white)](https://railway.app)
[![Express](https://img.shields.io/badge/Express.js-000?logo=express&logoColor=white)](https://expressjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://postgresql.org)

[🔗 Frontend Repo](https://github.com/pfix0/saas-frontend) · [🌐 الموقع الحي](https://saas-frontend-omega.vercel.app)

</div>

---

## 📋 نبذة

الـ Backend API لمنصة **ساس** — منصة تجارة إلكترونية SaaS مبنية بـ Express.js + TypeScript، مع قاعدة بيانات PostgreSQL. تعمل على Railway وتخدم الـ [Frontend](https://github.com/pfix0/saas-frontend) على Vercel.

## 🏗️ المعمارية

```
Vercel (Next.js) ──rewrites──→ Railway (Express API) ──→ PostgreSQL
     ↑                              ↑                        ↑
  Frontend                    Backend API               قاعدة البيانات
  /api/* يتحول                JWT + RBAC               ٢٠ جدول
  لـ Railway                  Multi-tenant              Multi-tenant
```

### تدفق الطلبات

```
1. المتصفح يطلب → /api/products
2. Next.js rewrites → https://railway-backend/api/products
3. Express يستقبل → requireAuth() → extractTenant()
4. Route handler → PostgreSQL query (WHERE tenant_id = $1)
5. JSON response → Frontend → المستخدم
```

## ⚡ التقنيات

| الحزمة | الاستخدام |
|--------|-----------|
| **express** | Web framework |
| **pg** | PostgreSQL client |
| **bcryptjs** | تشفير كلمات المرور |
| **jsonwebtoken** | JWT tokens (access + refresh) |
| **zod** | Validation |
| **helmet** | Security headers |
| **cors** | Cross-origin |
| **morgan** | Request logging |
| **slugify** | توليد slugs عربي |
| **nanoid** | معرفات قصيرة |
| **dotenv** | متغيرات البيئة |

## 📂 هيكل المشروع

```
saas-backend/
├── src/
│   ├── server.ts               # Express app + startup
│   ├── config/
│   │   └── database.ts         # PostgreSQL pool + helpers (query, insert, update)
│   ├── middleware/
│   │   └── auth.ts             # JWT verify + requireAuth + requireRole + extractTenant
│   └── routes/
│       ├── auth.ts             # تسجيل + دخول + تحديث التوكن
│       ├── products.ts         # CRUD منتجات
│       ├── categories.ts       # CRUD تصنيفات
│       ├── orders.ts           # طلبات + تحديث حالة
│       ├── customers.ts        # عملاء
│       ├── store.ts            # واجهة المتجر العامة (بدون مصادقة)
│       └── health.ts           # فحص صحة الخدمة
├── db/
│   ├── schema.sql              # ٢٠ جدول كامل
│   ├── migrate.ts              # تشغيل الـ schema
│   └── seed.ts                 # بيانات تجريبية
├── package.json
├── tsconfig.json
├── railway.toml                # إعدادات النشر
└── DEPLOY-GUIDE.md             # دليل النشر التفصيلي
```

## 🚀 التثبيت والتشغيل

### المتطلبات

- **Node.js** 18+ (مُوصى: 20+)
- **npm** 9+
- **PostgreSQL** 14+ (محلي أو Railway)

### ١. استنساخ المشروع

```bash
git clone https://github.com/pfix0/saas-backend.git
cd saas-backend
```

### ٢. تثبيت الحزم

```bash
npm install
```

### ٣. إعداد متغيرات البيئة

أنشئ ملف `.env` في جذر المشروع:

```env
# ═══ Database ═══
DATABASE_URL=postgresql://user:password@localhost:5432/saas_db

# ═══ JWT ═══
JWT_SECRET=your-secret-key-change-this-in-production

# ═══ Server ═══
PORT=4000
NODE_ENV=development

# ═══ Frontend (CORS) ═══
FRONTEND_URL=http://localhost:3000
```

### ٤. إعداد قاعدة البيانات

```bash
# إنشاء الجداول
npm run db:migrate

# (اختياري) بيانات تجريبية
npm run db:seed
```

### ٥. تشغيل محلي

```bash
npm run dev
```

يشتغل على http://localhost:4000

### ٦. البناء والتشغيل

```bash
npm run build
npm start
```

## 🌐 النشر على Railway

### الطريقة السريعة

1. اربط الريبو بـ Railway
2. Railway يكتشف `railway.toml` تلقائيًا
3. أضف خدمة PostgreSQL
4. أضف متغيرات البيئة

### متغيرات البيئة المطلوبة في Railway

| المتغير | القيمة | مطلوب |
|---------|--------|-------|
| `DATABASE_URL` | يتولّد تلقائي من PostgreSQL | ✅ |
| `JWT_SECRET` | مفتاح سري قوي | ✅ |
| `NODE_ENV` | `production` | ✅ |
| `FRONTEND_URL` | رابط Vercel frontend | ✅ |

### إعدادات railway.toml

```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "npm run build && npm start"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5
```

## 📡 API Reference

### المصادقة `🔓 = يتطلب JWT`

كل الطلبات المحمية تتطلب header:
```
Authorization: Bearer <access_token>
```

---

### 🏥 Health Check

| Method | Endpoint | Auth | الوصف |
|--------|----------|------|-------|
| `GET` | `/api/health` | ❌ | فحص صحة الخدمة |

---

### 🔐 Auth — المصادقة

| Method | Endpoint | Auth | الوصف |
|--------|----------|------|-------|
| `POST` | `/api/auth/register` | ❌ | تسجيل تاجر جديد + إنشاء متجر |
| `POST` | `/api/auth/login` | ❌ | تسجيل دخول |
| `POST` | `/api/auth/refresh` | ❌ | تحديث access token |

**Register — تسجيل جديد:**
```json
POST /api/auth/register
{
  "name": "محمد العلي",
  "email": "m@example.com",
  "phone": "+97455551234",
  "password": "MyStr0ng!Pass",
  "storeName": "متجر الفخامة"
}

// Response 201
{
  "success": true,
  "data": {
    "merchant": { "id": "uuid", "name": "...", "email": "...", "role": "owner" },
    "tenant": { "id": "uuid", "name": "...", "slug": "...", "storeUrl": "متجر-الفخامة.saas.qa" },
    "tokens": { "accessToken": "...", "refreshToken": "..." }
  }
}
```

**Login — تسجيل دخول:**
```json
POST /api/auth/login
{
  "email": "m@example.com",
  "password": "MyStr0ng!Pass"
}

// Response 200
{
  "success": true,
  "data": { "merchant": {...}, "tenant": {...}, "tokens": {...} }
}
```

**Refresh — تحديث التوكن:**
```json
POST /api/auth/refresh
{
  "refreshToken": "..."
}

// Response 200
{
  "success": true,
  "data": { "accessToken": "...", "refreshToken": "..." }
}
```

---

### 📦 Products — المنتجات

| Method | Endpoint | Auth | الوصف |
|--------|----------|------|-------|
| `GET` | `/api/products` | 🔓 | جلب كل المنتجات (مع بحث وفلترة) |
| `GET` | `/api/products/:id` | 🔓 | جلب منتج واحد |
| `POST` | `/api/products` | 🔓 | إضافة منتج جديد |
| `PUT` | `/api/products/:id` | 🔓 | تعديل منتج |
| `DELETE` | `/api/products/:id` | 🔓 | حذف منتج |

---

### 🏷️ Categories — التصنيفات

| Method | Endpoint | Auth | الوصف |
|--------|----------|------|-------|
| `GET` | `/api/categories` | 🔓 | جلب كل التصنيفات |
| `POST` | `/api/categories` | 🔓 | إضافة تصنيف |
| `PUT` | `/api/categories/:id` | 🔓 | تعديل تصنيف |
| `DELETE` | `/api/categories/:id` | 🔓 | حذف تصنيف |

---

### 🛒 Orders — الطلبات

| Method | Endpoint | Auth | الوصف |
|--------|----------|------|-------|
| `GET` | `/api/orders` | 🔓 | جلب كل الطلبات |
| `GET` | `/api/orders/:id` | 🔓 | تفاصيل طلب |
| `PUT` | `/api/orders/:id/status` | 🔓 | تحديث حالة الطلب |

---

### 👥 Customers — العملاء

| Method | Endpoint | Auth | الوصف |
|--------|----------|------|-------|
| `GET` | `/api/customers` | 🔓 | جلب كل العملاء |
| `GET` | `/api/customers/:id` | 🔓 | تفاصيل عميل |

---

### 🏪 Store — واجهة المتجر العامة

| Method | Endpoint | Auth | الوصف |
|--------|----------|------|-------|
| `GET` | `/api/store/:slug` | ❌ | بيانات المتجر |
| `GET` | `/api/store/:slug/products` | ❌ | منتجات المتجر |
| `GET` | `/api/store/:slug/categories` | ❌ | تصنيفات المتجر |
| `GET` | `/api/store/:slug/products/:productSlug` | ❌ | تفاصيل منتج |

---

## 🗄️ قاعدة البيانات

### الجداول (٢٠ جدول)

| # | الجدول | الوصف |
|---|--------|-------|
| 1 | `tenants` | المتاجر (multi-tenant) |
| 2 | `merchants` | التجار / المستخدمون |
| 3 | `categories` | تصنيفات المنتجات |
| 4 | `products` | المنتجات |
| 5 | `product_images` | صور المنتجات |
| 6 | `product_options` | خيارات (لون، مقاس...) |
| 7 | `product_variants` | المتغيرات (SKU) |
| 8 | `customers` | عملاء المتجر |
| 9 | `addresses` | عناوين العملاء |
| 10 | `orders` | الطلبات |
| 11 | `order_items` | عناصر الطلب |
| 12 | `order_status_history` | سجل حالات الطلب |
| 13 | `payments` | المدفوعات |
| 14 | `shipments` | الشحنات |
| 15 | `coupons` | كوبونات الخصم |
| 16 | `pages` | صفحات ثابتة (من نحن، الشروط) |
| 17 | `store_settings` | إعدادات المتجر |
| 18 | `reviews` | تقييمات المنتجات |
| 19 | `wishlist` | قائمة الأمنيات |
| 20 | `otp_codes` | رموز التحقق |

### Multi-Tenancy

كل جدول (ما عدا `tenants`) يحتوي عمود `tenant_id` يربطه بالمتجر. كل استعلام يفلتر بـ `tenant_id` لعزل البيانات بين المتاجر.

```sql
-- مثال: جلب منتجات متجر معين فقط
SELECT * FROM products WHERE tenant_id = $1;
```

## 🔐 نظام المصادقة

### JWT Tokens

| النوع | الصلاحية | الاستخدام |
|-------|----------|-----------|
| Access Token | ١٥ دقيقة | مصادقة الطلبات (`Authorization: Bearer ...`) |
| Refresh Token | ٧ أيام | تجديد الـ access token |

### الصلاحيات (RBAC)

| الدور | الوصف |
|-------|-------|
| `owner` | مالك المتجر — صلاحيات كاملة |
| `admin` | مدير — كل شي ما عدا إعدادات الحساب |
| `staff` | موظف — صلاحيات محدودة |

### تدفق المصادقة

```
1. POST /api/auth/register → accessToken + refreshToken
2. كل طلب: Authorization: Bearer <accessToken>
3. إذا انتهى: POST /api/auth/refresh → accessToken جديد
4. إذا انتهى الـ refresh: إعادة تسجيل دخول
```

## 📝 سجل التحديثات

### المحادثة ٣ب — لوحة تحكم المنصة 🛡️ (فبراير ٢٠٢٦)
- ✅ جدول platform_admins (auto-created + auto-migrated)
- ✅ ٦ أدوار: founder, director, supervisor, support, accountant, employee
- ✅ RBAC middleware: requirePlatformAdmin + requireRoles
- ✅ POST /api/admin/auth/setup + login + me
- ✅ GET /api/admin/stats (مالية إضافية حسب الدور)
- ✅ CRUD /api/admin/tenants + status + plan
- ✅ GET /api/admin/merchants
- ✅ CRUD /api/admin/staff (إدارة طاقم المنصة)

### المحادثة ٣ — لوحة التحكم + المنتجات 📦 (فبراير ٢٠٢٦)
- ✅ Frontend: Sidebar + Topbar تفاعلي
- ✅ Frontend: لوحة تحكم ديناميكية مربوطة بالـ API
- ✅ Frontend: CRUD منتجات كامل (قائمة + إضافة + تعديل + حذف)
- ✅ Frontend: إدارة التصنيفات (inline editing)
- ✅ Backend APIs مستخدمة: Products + Categories + Orders + Customers

### المحادثة ٢ — نظام المصادقة 🔐 (فبراير ٢٠٢٦)
- ✅ `POST /api/auth/register` — تسجيل تاجر + إنشاء متجر + صفحات افتراضية
- ✅ `POST /api/auth/login` — تسجيل دخول + JWT tokens
- ✅ `POST /api/auth/refresh` — تحديث التوكن
- ✅ Middleware: `requireAuth`, `requireRole`, `extractTenant`
- ✅ Password hashing (bcrypt, 12 rounds)

### المحادثة ١ — إعداد المشروع 🏗️ (فبراير ٢٠٢٦)
- ✅ Express.js + TypeScript setup
- ✅ PostgreSQL connection + helpers (query, insert, update)
- ✅ قاعدة بيانات كاملة (٢٠ جدول)
- ✅ Routes هيكل: products, categories, orders, customers, store
- ✅ CORS مُعد لـ Vercel
- ✅ Railway deployment (railway.toml)
- ✅ Health check endpoint

## 🗺️ خطة البناء

| # | المحادثة | الحالة |
|---|----------|--------|
| 1 | إعداد المشروع + قاعدة البيانات + API هيكل | ✅ مكتمل |
| 2 | نظام المصادقة (register/login/JWT) | ✅ مكتمل |
| 3 | لوحة التحكم + إدارة المنتجات | ✅ مكتمل |
| 4 | واجهة المتجر (Storefront) | 🔜 التالي |
| 5-8 | السلة + Checkout + الطلبات + العملاء | ⏳ قادم |
| 9-11 | الدفع (SADAD/SkipCash) + الشحن (Aramex/DHL) | ⏳ قادم |
| 12-15 | تقارير + تسويق + إعدادات + ثيمات | ⏳ قادم |
| 16-18 | الأمان + النشر النهائي + Landing Page | ⏳ قادم |

## ⚙️ أوامر مفيدة

```bash
npm run dev          # تشغيل development مع hot-reload
npm run build        # بناء TypeScript → dist/
npm start            # تشغيل production
npm run db:migrate   # إنشاء/تحديث الجداول
npm run db:seed      # بيانات تجريبية
```

## 🧪 اختبار سريع

```bash
# Health check
curl http://localhost:4000/api/health

# تسجيل تاجر جديد
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "محمد",
    "email": "test@example.com",
    "password": "Test1234!",
    "storeName": "متجر تجريبي"
  }'

# تسجيل دخول
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Test1234!"}'

# جلب منتجات (مع توكن)
curl http://localhost:4000/api/products \
  -H "Authorization: Bearer <your-access-token>"
```

---

<div align="center">

**ساس** · منصتك تبدأ من هنا

</div>
