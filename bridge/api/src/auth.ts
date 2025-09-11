import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';

export function generateToken(): string {
return jwt.sign({}, JWT_SECRET, { expiresIn: '1h' });
}

export function verifyToken(token: string): boolean {
try {
jwt.verify(token, JWT_SECRET);
return true;
} catch {
return false;
}
}
