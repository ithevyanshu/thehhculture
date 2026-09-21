/**
 * Starter data for DHH. Idempotent: safe to run repeatedly (upserts by slug).
 *
 * NOTE: This is a *starter* catalog so the app isn't empty on day one. Release dates
 * and credits are best-effort and should be verified/extended via the admin panel
 * (or the planned Spotify importer, see docs/ROADMAP.md). Images and Spotify/YouTube
 * IDs are intentionally left blank - add them from the admin panel to enable embeds.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { AlbumType, PrismaClient, Role } from '@prisma/client';
import { stageHandle, uniqueHandle } from '../src/lib/handles';

const prisma = new PrismaClient();

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/\$/g, 's')
    .replace(/Δ/gi, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const genres = [
  { slug: 'gully-rap', name: 'Gully Rap', description: 'Street-level storytelling born in the lanes of Mumbai.' },
  { slug: 'boom-bap', name: 'Boom Bap', description: 'Sample-heavy, drum-forward, lyric-first.' },
  { slug: 'desi-trap', name: 'Desi Trap', description: '808s, hi-hats and desi swagger.' },
  { slug: 'drill', name: 'Drill', description: 'Dark sliding bass and menacing flows.' },
  { slug: 'conscious', name: 'Conscious', description: 'Rap with something to say - politics, society, identity.' },
  { slug: 'punjabi-hip-hop', name: 'Punjabi Hip Hop', description: 'Punjabi flows over hip hop production.' },
  { slug: 'pop-rap', name: 'Pop Rap', description: 'Chart-friendly hooks and club bangers.' },
  { slug: 'south-hip-hop', name: 'South Hip Hop', description: 'Tamil, Malayalam, Kannada and Telugu rap.' },
  { slug: 'alternative', name: 'Alternative', description: 'Genre-bending, experimental and melodic rap.' },
];

const regions = [
  { slug: 'mumbai', name: 'Mumbai', state: 'Maharashtra' },
  { slug: 'pune', name: 'Pune', state: 'Maharashtra' },
  { slug: 'delhi', name: 'Delhi', state: 'Delhi NCR' },
  { slug: 'punjab', name: 'Punjab', state: 'Punjab' },
  { slug: 'bengaluru', name: 'Bengaluru', state: 'Karnataka' },
  { slug: 'kerala', name: 'Kerala', state: 'Kerala' },
  { slug: 'chennai', name: 'Chennai', state: 'Tamil Nadu' },
];

interface SeedSong {
  title: string;
  year?: number;
  date?: string;
  album?: string; // album title (must exist on the same artist)
  track?: number;
  genres?: string[];
  feat?: string[]; // artist names
}

interface SeedArtist {
  name: string;
  realName?: string;
  region: string;
  genres: string[];
  activeSince?: number;
  featured?: boolean;
  verified?: boolean;
  bio: string;
  albums?: { title: string; type: AlbumType; year: number }[];
  songs: SeedSong[];
}

const artists: SeedArtist[] = [
  {
    name: 'DIVINE',
    realName: 'Vivian Fernandes',
    region: 'mumbai',
    genres: ['gully-rap', 'conscious'],
    activeSince: 2011,
    featured: true,
    verified: true,
    bio: 'The voice of Mumbai\'s gullies. DIVINE took street rap from Andheri to the mainstream, inspired "Gully Boy", and founded Gully Gang Entertainment.',
    albums: [
      { title: 'Kohinoor', type: AlbumType.ALBUM, year: 2019 },
      { title: 'Punya Paap', type: AlbumType.ALBUM, year: 2020 },
      { title: 'Gunehgar', type: AlbumType.ALBUM, year: 2022 },
    ],
    songs: [
      { title: 'Yeh Mera Bombay', year: 2013 },
      { title: 'Mere Gully Mein', year: 2015, feat: ['Naezy'] },
      { title: 'Jungli Sher', year: 2016 },
      { title: 'Kaam 25', year: 2019 },
      { title: 'Kohinoor', year: 2019, album: 'Kohinoor', track: 1 },
      { title: 'Punya Paap', year: 2020, album: 'Punya Paap', track: 1 },
    ],
  },
  {
    name: 'Naezy',
    realName: 'Naved Shaikh',
    region: 'mumbai',
    genres: ['gully-rap', 'boom-bap'],
    activeSince: 2014,
    bio: 'Kurla\'s own. Naezy\'s iPad-shot "Aafat!" video helped kick-start the gully rap movement.',
    songs: [{ title: 'Aafat!', year: 2014 }],
  },
  {
    name: 'Emiway Bantai',
    realName: 'Bilal Shaikh',
    region: 'mumbai',
    genres: ['gully-rap', 'pop-rap'],
    activeSince: 2013,
    featured: true,
    verified: true,
    bio: 'Independent powerhouse from Mumbai known for relentless release schedules, diss tracks and the "Machayenge" series.',
    songs: [
      { title: 'Machayenge', year: 2019 },
      { title: 'Firse Machayenge', year: 2020 },
    ],
  },
  {
    name: 'MC STΔN',
    region: 'pune',
    genres: ['desi-trap', 'gully-rap'],
    activeSince: 2018,
    featured: true,
    verified: true,
    bio: 'Pune rapper with a raw, emotional delivery who built one of the most devoted fanbases in Indian hip hop.',
    albums: [{ title: 'Insaan', type: AlbumType.ALBUM, year: 2022 }],
    songs: [
      { title: 'Wata', year: 2019 },
      { title: 'Khuja Mat', year: 2020 },
      { title: 'Basti Ka Hasti', year: 2022 },
    ],
  },
  {
    name: 'Seedhe Maut',
    region: 'delhi',
    genres: ['boom-bap', 'desi-trap', 'conscious'],
    activeSince: 2016,
    featured: true,
    verified: true,
    bio: 'Delhi duo Encore ABJ and Calm - technical, relentless and fiercely independent. Pillars of the Azadi Records era.',
    albums: [
      { title: 'Bayaan', type: AlbumType.ALBUM, year: 2018 },
      { title: 'Nayaab', type: AlbumType.ALBUM, year: 2022 },
      { title: 'Lunch Break', type: AlbumType.MIXTAPE, year: 2023 },
    ],
    songs: [
      { title: 'Nanchaku', year: 2021, feat: ['MC STΔN'] },
      { title: 'Namastute', year: 2021 },
    ],
  },
  {
    name: 'KR$NA',
    realName: 'Krishna Kaul',
    region: 'delhi',
    genres: ['boom-bap', 'desi-trap'],
    activeSince: 2006,
    featured: true,
    verified: true,
    bio: 'One of the sharpest lyricists in the country. A veteran of the scene who stays at the top of every "best rapper" debate.',
    albums: [{ title: 'Far From Over', type: AlbumType.ALBUM, year: 2023 }],
    songs: [
      { title: 'Makasam', year: 2020 },
      { title: 'Hola Amigo', year: 2021, feat: ['Seedhe Maut'] },
      { title: 'Joota Japani', year: 2023 },
    ],
  },
  {
    name: 'Raftaar',
    realName: 'Dilin Nair',
    region: 'delhi',
    genres: ['pop-rap', 'desi-trap'],
    activeSince: 2008,
    verified: true,
    bio: 'Fast-rapping Delhi star who bridged underground credibility and Bollywood reach.',
    albums: [{ title: 'Mr. Nair', type: AlbumType.ALBUM, year: 2020 }],
    songs: [
      { title: 'Swag Mera Desi', year: 2014 },
      { title: 'Ghana Kasoota', year: 2019 },
      { title: 'Mantoiyat', year: 2020, album: 'Mr. Nair' },
    ],
  },
  {
    name: 'Badshah',
    realName: 'Aditya Prateek Singh Sisodia',
    region: 'delhi',
    genres: ['pop-rap', 'punjabi-hip-hop'],
    activeSince: 2006,
    verified: true,
    bio: 'Hitmaker behind countless party anthems and one of the most-streamed Indian artists.',
    songs: [
      { title: 'DJ Waley Babu', year: 2015 },
      { title: 'Paagal', year: 2019 },
      { title: 'Genda Phool', year: 2020 },
    ],
  },
  {
    name: 'Prabh Deep',
    realName: 'Prabhdeep Singh',
    region: 'delhi',
    genres: ['conscious', 'boom-bap', 'alternative'],
    activeSince: 2014,
    featured: true,
    bio: 'Tilak Nagar storyteller whose debut "Class-Sikh" is considered a landmark Indian hip hop album.',
    albums: [{ title: 'Class-Sikh', type: AlbumType.ALBUM, year: 2017 }],
    songs: [{ title: 'Suno', year: 2017, album: 'Class-Sikh' }],
  },
  {
    name: 'Sidhu Moose Wala',
    realName: 'Shubhdeep Singh Sidhu',
    region: 'punjab',
    genres: ['punjabi-hip-hop', 'drill'],
    activeSince: 2016,
    verified: true,
    bio: 'Mansa\'s icon who fused Punjabi folk swagger with hip hop and drill, becoming a global voice for Punjabi music.',
    songs: [
      { title: 'So High', year: 2017 },
      { title: '295', year: 2021 },
    ],
  },
  {
    name: 'Brodha V',
    realName: 'Vighnesh Shivanand',
    region: 'bengaluru',
    genres: ['south-hip-hop', 'conscious'],
    activeSince: 2010,
    bio: 'Bengaluru rapper and Machas With Attitude co-founder, known for blending devotion and hip hop.',
    songs: [{ title: 'Aathma Raama', year: 2016 }],
  },
  {
    name: 'Hanumankind',
    realName: 'Sooraj Cherukat',
    region: 'kerala',
    genres: ['south-hip-hop', 'desi-trap', 'alternative'],
    activeSince: 2019,
    featured: true,
    verified: true,
    bio: 'Kerala-born, Bengaluru-based rapper whose "Big Dawgs" became a global viral moment for Indian hip hop.',
    songs: [{ title: 'Big Dawgs', date: '2024-07-09' }],
  },
  {
    name: 'Vedan',
    realName: 'Hirandas Murali',
    region: 'kerala',
    genres: ['south-hip-hop', 'conscious'],
    activeSince: 2020,
    bio: 'Malayalam rapper whose politically charged verses speak for the marginalised.',
    songs: [{ title: 'Voice of the Voiceless', year: 2020 }],
  },
  {
    name: 'Arivu',
    region: 'chennai',
    genres: ['south-hip-hop', 'conscious'],
    activeSince: 2017,
    bio: 'Tamil lyricist and rapper whose anti-caste storytelling reached millions with "Enjoy Enjaami".',
    songs: [{ title: 'Enjoy Enjaami', year: 2021 }],
  },
  {
    name: 'Dino James',
    region: 'mumbai',
    genres: ['pop-rap', 'alternative'],
    activeSince: 2014,
    bio: 'Mumbai rapper known for heartfelt, confessional storytelling.',
    songs: [{ title: 'Loser', year: 2019 }],
  },
];

async function main() {
  console.log('Seeding genres & regions...');
  for (const g of genres) {
    await prisma.genre.upsert({ where: { slug: g.slug }, create: g, update: { name: g.name, description: g.description } });
  }
  for (const r of regions) {
    await prisma.region.upsert({ where: { slug: r.slug }, create: r, update: { name: r.name, state: r.state } });
  }

  console.log('Seeding artists & albums...');
  const artistIds = new Map<string, string>();
  for (const a of artists) {
    const slug = slugify(a.name);
    const region = await prisma.region.findUniqueOrThrow({ where: { slug: a.region } });
    const data = {
      name: a.name,
      realName: a.realName ?? null,
      bio: a.bio,
      activeSince: a.activeSince ?? null,
      featured: a.featured ?? false,
      verified: a.verified ?? false,
      regionId: region.id,
      genres: { set: a.genres.map((s) => ({ slug: s })) },
    };
    const artist = await prisma.artist.upsert({
      where: { slug },
      create: { ...data, slug, handle: await uniqueHandle(stageHandle(a.name)), genres: { connect: a.genres.map((s) => ({ slug: s })) } },
      update: data,
    });
    artistIds.set(a.name, artist.id);

    for (const al of a.albums ?? []) {
      const albumSlug = slugify(`${a.name} ${al.title}`);
      await prisma.album.upsert({
        where: { slug: albumSlug },
        create: { slug: albumSlug, title: al.title, type: al.type, releaseDate: new Date(Date.UTC(al.year, 0, 1)), artistId: artist.id },
        update: { title: al.title, type: al.type },
      });
    }
  }

  console.log('Seeding songs...');
  for (const a of artists) {
    const artistId = artistIds.get(a.name)!;
    for (const s of a.songs) {
      const slug = slugify(`${a.name} ${s.title}`);
      const album = s.album
        ? await prisma.album.findUnique({ where: { slug: slugify(`${a.name} ${s.album}`) }, select: { id: true } })
        : null;
      const releaseDate = s.date ? new Date(s.date) : s.year ? new Date(Date.UTC(s.year, 0, 1)) : null;
      const genreSlugs = s.genres ?? a.genres;
      const featureIds = (s.feat ?? []).map((name) => {
        const id = artistIds.get(name);
        if (!id) throw new Error(`Unknown featured artist "${name}" on ${a.name} - ${s.title}`);
        return id;
      });

      const song = await prisma.song.upsert({
        where: { slug },
        create: {
          slug,
          title: s.title,
          artistId,
          albumId: album?.id ?? null,
          trackNumber: s.track ?? null,
          releaseDate,
          genres: { connect: genreSlugs.map((g) => ({ slug: g })) },
        },
        update: {
          title: s.title,
          albumId: album?.id ?? null,
          releaseDate,
          genres: { set: genreSlugs.map((g) => ({ slug: g })) },
        },
      });
      await prisma.songFeature.createMany({
        data: featureIds.map((id) => ({ songId: song.id, artistId: id })),
        skipDuplicates: true,
      });
    }
  }

  // ---- Admin account ----
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword && adminPassword !== 'change-me-admin-password') {
    await prisma.user.upsert({
      where: { email: adminEmail },
      create: {
        email: adminEmail,
        username: 'admin',
        displayName: 'DHH Admin',
        role: Role.ADMIN,
        onboarded: true,
        passwordHash: await bcrypt.hash(adminPassword, 12),
      },
      update: { role: Role.ADMIN },
    });
    console.log(`Admin account ready: ${adminEmail}`);
  } else {
    console.warn('Skipping admin account: set ADMIN_EMAIL and a real ADMIN_PASSWORD in .env');
  }

  // ---- Demo listener (development only) so the personalized home has signal ----
  // Needs DEMO_PASSWORD in .env: a password written into the repo is a published
  // password, and this account has reached a live database before.
  const demoPassword = process.env.DEMO_PASSWORD;
  if (process.env.NODE_ENV === 'production') {
    console.log('Skipping the demo account: NODE_ENV is production');
  } else if (!demoPassword) {
    console.log('Skipping the demo account: set DEMO_PASSWORD in .env to create it');
  } else {
    const demo = await prisma.user.upsert({
      where: { email: 'demo@dhh.local' },
      create: {
        email: 'demo@dhh.local',
        username: 'demo',
        displayName: 'Demo Listener',
        onboarded: true,
        passwordHash: await bcrypt.hash(demoPassword, 12),
        favoriteGenres: { connect: [{ slug: 'boom-bap' }, { slug: 'gully-rap' }] },
        favoriteRegions: { connect: [{ slug: 'delhi' }, { slug: 'mumbai' }] },
      },
      update: {},
    });
    const follow = ['DIVINE', 'Seedhe Maut', 'Hanumankind'].map((n) => artistIds.get(n)!);
    await prisma.follow.createMany({
      data: follow.map((artistId) => ({ userId: demo.id, artistId })),
      skipDuplicates: true,
    });
    const likedSlugs = ['divine-mere-gully-mein', 'seedhe-maut-nanchaku', 'hanumankind-big-dawgs', 'krsna-hola-amigo'];
    const liked = await prisma.song.findMany({ where: { slug: { in: likedSlugs } }, select: { id: true } });
    await prisma.songLike.createMany({
      data: liked.map((s) => ({ userId: demo.id, songId: s.id })),
      skipDuplicates: true,
    });
    console.log('Demo account ready: demo@dhh.local, password from DEMO_PASSWORD (dev only)');
  }

  const counts = await Promise.all([prisma.artist.count(), prisma.album.count(), prisma.song.count()]);
  console.log(`Done: ${counts[0]} artists, ${counts[1]} albums, ${counts[2]} songs.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
