import { client } from "@/lib/sanity";

type Author = {
  _id: string;
  fullName: string;
  email: string;
  slug: { current: string };
};

async function getAuthors(): Promise<Author[]> {
  return client.fetch(`*[_type == "author"]{_id, fullName, email, slug}`);
}

export default async function Home() {
  const authors = await getAuthors();

  return (
    <main className="min-h-screen p-12 bg-zinc-50 dark:bg-zinc-900">
      <h1 className="text-3xl font-bold mb-8 text-zinc-900 dark:text-zinc-50">
        Auteurs — Audacem
      </h1>
      <ul className="flex flex-col gap-4">
        {authors.map((author) => (
          <li
            key={author._id}
            className="p-6 bg-white dark:bg-zinc-800 rounded-xl shadow-sm border border-zinc-100 dark:border-zinc-700"
          >
            <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {author.fullName}
            </p>
            <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
              {author.email}
            </p>
            <p className="text-zinc-400 text-xs mt-1">
              slug: {author.slug?.current}
            </p>
          </li>
        ))}
      </ul>
      {authors.length === 0 && (
        <p className="text-zinc-400">Aucun auteur trouvé.</p>
      )}
    </main>
  );
}