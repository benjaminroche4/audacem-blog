import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { toHTML } from '@portabletext/to-html';
import { client } from '@/lib/sanity';

const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET!;

function verifyShopifySignature(query: URLSearchParams): boolean {
  const signature = query.get('signature');

  if (!signature) return false;

  const params = new URLSearchParams(query);
  params.delete('signature');

  const sortedParams = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const hash = crypto
    .createHmac('sha256', SHOPIFY_CLIENT_SECRET)
    .update(sortedParams)
    .digest('hex');

  return hash === signature;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  if (!verifyShopifySignature(searchParams)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const pathPrefix = searchParams.get('path_prefix') || '';
  const slug = pathPrefix.replace(/^\//, '');

  try {
    const html = await fetchAndRenderPost(slug);

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'application/liquid',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('Shopify proxy error:', error);
    return new NextResponse('Content not found', { status: 404 });
  }
}

async function fetchAndRenderPost(slug: string): Promise<string> {
  const query = `*[_type == "post" && slug.current == $slug][0]{
    title,
    body,
    "mainImageUrl": mainImage.asset->url,
    publishedAt,
    "authorName": author->name
  }`;

  const post = await client.fetch(query, { slug });

  if (!post) throw new Error(`Post not found: ${slug}`);

  const bodyHTML = post.body ? toHTML(post.body) : '';
  const publishedDate = post.publishedAt
    ? new Date(post.publishedAt).toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(post.title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
      color: #1a1a1a;
    }
    h1 { font-size: 2.5rem; margin-bottom: 1rem; }
    h2 { font-size: 1.75rem; margin-top: 2rem; }
    h3 { font-size: 1.375rem; margin-top: 1.5rem; }
    .meta { color: #666; margin-bottom: 2rem; font-size: 0.9rem; }
    img { max-width: 100%; height: auto; border-radius: 8px; margin-bottom: 2rem; }
    p { margin-bottom: 1rem; }
  </style>
</head>
<body>
  <article>
    <h1>${escapeHTML(post.title)}</h1>
    <div class="meta">
      ${publishedDate ? `Publié le ${publishedDate}` : ''}
      ${post.authorName ? ` · Par ${escapeHTML(post.authorName)}` : ''}
    </div>
    ${post.mainImageUrl ? `<img src="${post.mainImageUrl}" alt="${escapeHTML(post.title)}">` : ''}
    <div class="content">
      ${bodyHTML}
    </div>
  </article>
</body>
</html>`;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
