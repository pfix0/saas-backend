/**
 * ساس — Auth Middleware
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  merchantId: string;
  tenantId: string;
  role: string;
  email: string;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      merchant?: AuthPayload;
      tenantId?: string;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

/**
 * Protect routes — requires valid JWT
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'غير مصرح — يرجى تسجيل الدخول',
    });
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.merchant = payload;
    req.tenantId = payload.tenantId;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'انتهت صلاحية الجلسة — سجّل دخولك مجددًا',
        code: 'TOKEN_EXPIRED',
      });
    }
    return res.status(401).json({
      success: false,
      error: 'توكن غير صالح',
    });
  }
}

/**
 * Require specific role
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.merchant) {
      return res.status(401).json({ success: false, error: 'غير مصرح' });
    }
    if (!roles.includes(req.merchant.role)) {
      return res.status(403).json({
        success: false,
        error: 'ليس لديك صلاحية لهذا الإجراء',
      });
    }
    next();
  };
}

/**
 * Extract tenant from subdomain or header
 */
export function extractTenant(req: Request, _res: Response, next: NextFunction) {
  // From auth token
  if (req.merchant?.tenantId) {
    req.tenantId = req.merchant.tenantId;
  }
  // From header (for storefront)
  else if (req.headers['x-tenant-id']) {
    req.tenantId = req.headers['x-tenant-id'] as string;
  }
  next();
}

/**
 * Generate tokens
 */
export function generateTokens(payload: AuthPayload) {
  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: 900, // 15 minutes in seconds
  });

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: 604800 } // 7 days in seconds
  );

  return { accessToken, refreshToken };
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): AuthPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (payload.type !== 'refresh') return null;
    const { type, iat, exp, ...rest } = payload;
    return rest as AuthPayload;
  } catch {
    return null;
  }
}
