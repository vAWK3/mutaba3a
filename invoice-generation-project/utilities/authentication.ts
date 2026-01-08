import type { NextRequest } from 'next/server'

export function isAuthenticated(request: NextRequest) {
    return true;
}