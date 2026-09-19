/**
 * Seeds rap shows (idempotent: upserts by slug, replaces each season's cast).
 *   npx tsx scripts/seed-shows.ts
 *
 * Sources (verify/extend in Admin -> Shows):
 *   MTV Hustle: https://en.wikipedia.org/wiki/MTV_Hustle + winners round-ups
 *   Legacy S1: fan coverage of the finale (winner + top 3), Sept 2026
 */
import 'dotenv/config';
import { ShowRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { slugify } from '../src/lib/slug';
import { stageHandle, uniqueHandle } from '../src/lib/handles';

type Person = { name: string; realName?: string; producer?: boolean };
type Season = { number: number; year?: number; title?: string; cast: [Person | string, ShowRole][] };

const shows: { name: string; network?: string; description: string; seasons: Season[] }[] = [
  {
    name: 'MTV Hustle',
    network: 'MTV India',
    description: "India's first hip hop reality show, where rappers battle through cyphers, collabs and solo rounds for the title.",
    seasons: [
      {
        number: 1,
        year: 2019,
        cast: [
          ['M-Zee Bella', 'WINNER'],
          ['EPR', 'RUNNER_UP'],
          ['Raftaar', 'JUDGE'],
          [{ name: 'Nucleya', producer: true }, 'JUDGE'],
          ['Raja Kumari', 'JUDGE'],
        ],
      },
      {
        number: 2,
        year: 2022,
        title: 'Hustle 2.0',
        cast: [
          [{ name: 'MC Square', realName: 'Abhishek Bainsla' }, 'WINNER'],
          [{ name: 'Paradox', realName: 'Tanishq Singh' }, 'RUNNER_UP'],
          ['Badshah', 'JUDGE'],
        ],
      },
      {
        number: 3,
        year: 2023,
        cast: [
          [{ name: 'Uday', realName: 'Uday Pandhi' }, 'WINNER'],
          [{ name: 'Bassick', realName: 'Shlok Verma' }, 'RUNNER_UP'],
          ['Badshah', 'JUDGE'],
        ],
      },
      {
        number: 4,
        year: 2024,
        cast: [
          [{ name: 'Lashcurry', realName: 'Vinayak Lashkari' }, 'WINNER'],
          [{ name: 'Naam Sujal', realName: 'Sujal Dupare' }, 'RUNNER_UP'],
          ['Raftaar', 'JUDGE'],
          ['Ikka', 'JUDGE'],
        ],
      },
    ],
  },
  {
    name: 'Legacy',
    description: 'Rap competition show. Season 1 crowned Prathamesh, with Akki and Hussain completing the top three.',
    seasons: [
      {
        number: 1,
        year: 2026,
        cast: [
          ['Prathamesh', 'WINNER'],
          ['Akki', 'FINALIST'],
          ['Hussain', 'FINALIST'],
        ],
      },
    ],
  },
];

/** Find an artist by slug (the @handle); create a name-only profile if missing. */
async function artistFor(p: Person | string) {
  const person = typeof p === 'string' ? { name: p } : p;
  const slug = slugify(person.name);
  const existing = await prisma.artist.findUnique({ where: { slug }, select: { id: true } });
  if (existing) {
    if (person.producer) await prisma.artist.update({ where: { slug }, data: { isProducer: true } });
    return { id: existing.id, created: false, slug };
  }
  const created = await prisma.artist.create({
    data: {
      slug,
      name: person.name,
      handle: await uniqueHandle(stageHandle(person.name)),
      realName: person.realName ?? null,
      isProducer: !!person.producer,
    },
    select: { id: true },
  });
  return { id: created.id, created: true, slug };
}

(async () => {
  const createdArtists: string[] = [];
  for (const s of shows) {
    const slug = slugify(s.name);
    const show = await prisma.show.upsert({
      where: { slug },
      create: { slug, name: s.name, network: s.network ?? null, description: s.description },
      update: {},
    });
    for (const season of s.seasons) {
      const row = await prisma.showSeason.upsert({
        where: { showId_number: { showId: show.id, number: season.number } },
        create: { showId: show.id, number: season.number, year: season.year ?? null, title: season.title ?? null },
        update: {},
      });
      const cast = [];
      for (const [person, role] of season.cast) {
        const a = await artistFor(person);
        if (a.created) createdArtists.push(`@${a.slug}`);
        cast.push({ seasonId: row.id, artistId: a.id, role });
      }
      await prisma.$transaction([
        prisma.showAppearance.deleteMany({ where: { seasonId: row.id } }),
        prisma.showAppearance.createMany({ data: cast, skipDuplicates: true }),
      ]);
      console.log(`${s.name} S${season.number}: ${cast.length} cast`);
    }
  }
  console.log(createdArtists.length ? `New artist profiles: ${createdArtists.join(', ')}` : 'No new artists needed');
  await prisma.$disconnect();
})();
