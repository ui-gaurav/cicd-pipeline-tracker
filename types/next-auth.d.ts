import { DefaultSession } from 'next-auth';
import '@auth/core/jwt';

declare module 'next-auth' {
  interface User {
    role: string;
  }
  interface Session {
    user: {
      id?: string;
      role: string;
    } & DefaultSession['user'];
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    role?: string;
  }
}
