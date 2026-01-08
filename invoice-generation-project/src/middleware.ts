import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isAuthenticated } from '../utilities/authentication'

// This function can be marked `async` if using `await` inside
export function middleware(request: NextRequest) {
    // Call our authentication function to check the request
    if (!isAuthenticated(request)) {
        // Respond with JSON indicating an error message
        return NextResponse.redirect(new URL('/login', request.url))
    }

}

// See "Matching Paths" below to learn more
export const config = {
    //   matcher: '/about/:path*',
    matcher: [
        '/((?!api|_next/static|_next/image|logo|login|signup|home|^$).*)',
    ]
}