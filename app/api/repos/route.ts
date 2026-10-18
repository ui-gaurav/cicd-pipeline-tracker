import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Repos read access granted (GET).',
  });
}

export async function POST() {
  return NextResponse.json({
    success: true,
    message: 'Repos write access granted (POST).',
  });
}
