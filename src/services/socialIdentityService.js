import jwt from 'jsonwebtoken';

const FIREBASE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'teatr-b7904';
const MAX_TOKEN_LENGTH = 12000;
const FIREBASE_CLOCK_SKEW_SECONDS = Math.min(
  300,
  Math.max(0, Number(process.env.FIREBASE_CLOCK_SKEW_SECONDS || 300)),
);

let certificateCache = { expiresAt: 0, certificates: null };

const identityError = (message, statusCode = 401) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getToken = (value) => {
  const token = String(value || '').trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    throw identityError('Google нэвтрэлтийн баталгаажуулах токен буруу байна.');
  }
  return token;
};

export const validateFirebaseClaims = (
  decoded,
  now = Math.floor(Date.now() / 1000),
  clockSkewSeconds = FIREBASE_CLOCK_SKEW_SECONDS,
) => {
  const subject = String(decoded?.sub || '');
  const issuedAt = Number(decoded?.iat);
  const hasAuthTime = decoded?.auth_time !== undefined && decoded?.auth_time !== null;
  const authTime = hasAuthTime ? Number(decoded.auth_time) : null;
  const latestAllowedTime = now + clockSkewSeconds;

  if (!subject || subject.length > 128) return false;
  if (!Number.isFinite(issuedAt) || issuedAt > latestAllowedTime) return false;
  if (hasAuthTime && (!Number.isFinite(authTime) || authTime > latestAllowedTime)) return false;
  return true;
};

const getFirebaseCertificates = async (forceRefresh = false) => {
  if (!forceRefresh && certificateCache.certificates && certificateCache.expiresAt > Date.now()) {
    return certificateCache.certificates;
  }

  let response;
  try {
    response = await fetch(FIREBASE_CERTS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw identityError('Firebase token баталгаажуулах үйлчилгээ түр боломжгүй байна.', 503);
  }
  if (!response.ok) {
    throw identityError('Firebase token баталгаажуулах үйлчилгээ түр боломжгүй байна.', 503);
  }

  const certificates = await response.json();
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 300);
  certificateCache = {
    certificates,
    expiresAt: Date.now() + Math.max(60, maxAge) * 1000,
  };
  return certificates;
};

const verifyFirebaseIdToken = async (value) => {
  const token = getToken(value);
  const decodedHeader = jwt.decode(token, { complete: true });
  const { alg, kid } = decodedHeader?.header || {};
  if (alg !== 'RS256' || !kid) {
    throw identityError('Firebase ID token header буруу байна.');
  }

  let certificates = await getFirebaseCertificates();
  let certificate = certificates[kid];
  if (!certificate) {
    certificates = await getFirebaseCertificates(true);
    certificate = certificates[kid];
  }
  if (!certificate) {
    throw identityError('Firebase ID token signing key олдсонгүй.');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, certificate, {
      algorithms: ['RS256'],
      audience: FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      clockTolerance: FIREBASE_CLOCK_SKEW_SECONDS,
    });
  } catch {
    throw identityError('Firebase ID token баталгаажсангүй.');
  }

  if (!validateFirebaseClaims(decoded)) {
    throw identityError('Firebase ID token claim буруу байна.');
  }
  if (decoded.firebase?.sign_in_provider !== 'google.com') {
    throw identityError('Зөвхөн Google-ээр баталгаажсан Firebase token зөвшөөрнө.');
  }
  if (!decoded.email || decoded.email_verified !== true) {
    throw identityError('Google имэйл баталгаажаагүй байна.');
  }

  return {
    provider: 'google',
    providerId: String(decoded.sub),
    email: String(decoded.email).trim().toLowerCase(),
    name: decoded.name || decoded.email,
    avatarUrl: decoded.picture || '',
  };
};

const verifyGoogleAccessToken = async (value) => {
  const token = getToken(value);
  let response;
  try {
    response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw identityError('Google token баталгаажуулах үйлчилгээ түр боломжгүй байна.', 503);
  }
  if (!response.ok) {
    throw identityError('Google access token баталгаажсангүй.');
  }

  const profile = await response.json();
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    throw identityError('Google хэрэглэгчийн имэйл баталгаажаагүй байна.');
  }

  return {
    provider: 'google',
    providerId: String(profile.sub),
    email: String(profile.email).trim().toLowerCase(),
    name: profile.name || profile.email,
    avatarUrl: profile.picture || '',
  };
};

export const verifySocialIdentity = async ({ idToken, accessToken }) => {
  if (idToken) return verifyFirebaseIdToken(idToken);
  if (accessToken) return verifyGoogleAccessToken(accessToken);
  throw identityError('Google нэвтрэлтийн баталгаажуулах токен шаардлагатай.');
};
