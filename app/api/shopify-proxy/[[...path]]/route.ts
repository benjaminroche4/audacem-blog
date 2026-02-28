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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const searchParams = request.nextUrl.searchParams;

  if (!verifyShopifySignature(searchParams)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { path } = await params;
  const slug = path?.join('/') || '';

  try {
    const html = !slug || slug === 'liste'
      ? await fetchAndRenderAuthorList()
      : await fetchAndRenderPost(slug);

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

async function fetchAndRenderAuthorList(): Promise<string> {
  const query = `*[_type == "author"] | order(fullName asc) {
    fullName,
    "slug": slug.current,
    "photoUrl": photo.asset->url
  }`;

  const authors = await client.fetch(query);

  if (!authors || authors.length === 0) throw new Error('No authors found');

  const authorsHTML = authors.map((author: { fullName: string; slug: string; photoUrl: string }) => `
    <div class="author-card">
      ${author.photoUrl ? `<img src="${author.photoUrl}" alt="${escapeHTML(author.fullName)}">` : ''}
      <h2>${escapeHTML(author.fullName)}</h2>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nos auteurs</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      color: #1a1a1a;
    }
    h1 { font-size: 2rem; margin-bottom: 2rem; }
    .authors-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 2rem;
    }
    .author-card {
      text-align: center;
    }
    .author-card img {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      object-fit: cover;
      margin-bottom: 1rem;
    }
    .author-card h2 {
      font-size: 1rem;
      margin: 0;
    }
  </style>
</head>
<body>
  <h1>Nos auteurs</h1>
  <div class="authors-grid">
    ${authorsHTML}
  </div>
</body>
</html>`;
}

async function fetchAndRenderPost(slug: string): Promise<string> {
  const query = `*[_type == "blog" && slug.current == $slug][0]{
    title,
    shortDescription,
    body,
    "mainPhotoUrl": mainPhoto.asset->url,
    "mainPhotoAlt": mainPhoto.alt,
    publishedAt,
    "authors": authors[]->{ fullName }
  }`;

  const post = await client.fetch(query, { slug });

  if (!post) throw new Error(`Post not found: ${slug}`);

  const bodyHTML = renderBody(post.body);

  const publishedDate = post.publishedAt
    ? new Date(post.publishedAt).toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  const authorNames = post.authors?.map((a: { fullName: string }) => escapeHTML(a.fullName)).join(', ') || '';

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
    .faq-item { margin-bottom: 1.5rem; }
    .faq-item strong { display: block; margin-bottom: 0.25rem; }
  </style>
</head>
<body>
  <article>
    <h1>${escapeHTML(post.title)}</h1>
    <div class="meta">
      ${publishedDate ? `Publié le ${publishedDate}` : ''}
      ${authorNames ? ` · Par ${authorNames}` : ''}
    </div>
    ${post.mainPhotoUrl ? `<img src="${post.mainPhotoUrl}" alt="${escapeHTML(post.mainPhotoAlt || post.title)}">` : ''}
    <div class="content">
      ${bodyHTML}
    </div>
  </article>
</body>
</html>`;
}

type WysiwygBlock = { _type: 'wysiwygBlock'; title: string; content: unknown[] };
type FaqBlock = { _type: 'faqBlock'; title: string; items: { question: string; answer: string }[] };
type CtaBlock = { _type: 'ctaBlock'; title: string; description: string; btnText: string };
type QuickAnswerBlock = { _type: 'quickAnswerBlock'; title: string; content: unknown[] };
type BodyBlock = WysiwygBlock | FaqBlock | CtaBlock | QuickAnswerBlock;

function renderBody(body: BodyBlock[]): string {
  if (!body) return '';

  return body.map((block) => {
    switch (block._type) {
      case 'wysiwygBlock':
        return `<section>
          <h2>${escapeHTML(block.title)}</h2>
          ${toHTML(block.content)}
        </section>`;

      case 'faqBlock':
        return `<section>
          <h2>${escapeHTML(block.title)}</h2>
          ${block.items.map((item) => `
            <div class="faq-item">
              <strong>${escapeHTML(item.question)}</strong>
              <p>${escapeHTML(item.answer)}</p>
            </div>
          `).join('')}
        </section>`;

      case 'ctaBlock':
        return `<section>
          <h2>${escapeHTML(block.title)}</h2>
          <p>${escapeHTML(block.description)}</p>
          <p><strong>${escapeHTML(block.btnText)}</strong></p>
        </section>`;

      case 'quickAnswerBlock':
        return `<section>
          <h2>${escapeHTML(block.title)}</h2>
          ${toHTML(block.content)}
        </section>`;

      default:
        return '';
    }
  }).join('');
}

function escapeHTML(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}