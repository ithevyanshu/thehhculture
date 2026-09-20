/**
 * The spreadsheet format: one column list per kind of row, shared by the downloadable
 * template, the upload parser and the admin panel's help text.
 *
 * Blank cells mean "leave this as it is", so a file can carry a single column of
 * corrections without touching anything else.
 */

export type SheetKind = 'songs' | 'albums' | 'artists';

export interface SheetColumn {
  /** Header text in the file. Matching ignores case, spaces and punctuation. */
  header: string;
  /** What the admin panel and template notes say about it. */
  hint: string;
  /** Columns that identify an existing row; at least one must be filled. */
  key?: boolean;
  required?: boolean;
  example: string;
}

export const SHEETS: Record<SheetKind, { label: string; note: string; columns: SheetColumn[] }> = {
  songs: {
    label: 'Songs',
    note: 'One row per song. "Artist @handle" says whose song it is; the rest fills in the details.',
    columns: [
      { header: 'Artist @handle', hint: 'The artist who owns the song, e.g. @seedhe_maut. Their name also works.', key: true, required: true, example: '@krsna' },
      { header: 'Title', hint: 'Song title. With the artist, this finds an existing song to update.', key: true, required: true, example: 'Joota Japani' },
      { header: 'New title', hint: 'Only to rename a song: the row is found by Title, then renamed to this.', example: '' },
      { header: 'Album', hint: 'Album or EP title. Must already exist for that artist, or be in the Albums sheet.', example: 'Still Here' },
      { header: 'Release date', hint: 'YYYY-MM-DD, or a real date cell.', example: '2023-06-16' },
      { header: 'Duration (sec)', hint: 'Whole seconds, e.g. 214.', example: '214' },
      { header: 'Track number', hint: 'Position on the album.', example: '3' },
      { header: 'Genres', hint: 'Comma-separated, must match existing genres, e.g. Gully Rap, Boom Bap.', example: 'Boom Bap' },
      { header: 'Featuring', hint: 'Comma-separated @handles of featured artists. Replaces the current list.', example: '@raftaar, @emiway_bantai' },
      { header: 'Produced by', hint: 'Comma-separated @handles of producers. Replaces the current list.', example: '@karan_kanchan' },
      { header: 'Spotify link', hint: 'Track URL or ID; switches on the embed.', example: 'https://open.spotify.com/track/…' },
      { header: 'YouTube link', hint: 'Video URL or ID.', example: 'https://youtu.be/…' },
      { header: 'Cover URL', hint: 'Image link. Falls back to the album cover.', example: '' },
      { header: 'Lyrics URL', hint: 'Link out to lyrics (Genius etc.).', example: '' },
      { header: 'Explicit', hint: 'yes / no.', example: 'yes' },
    ],
  },
  albums: {
    label: 'Albums & EPs',
    note: 'One row per release. Songs point at these by title in the Songs sheet.',
    columns: [
      { header: 'Artist @handle', hint: 'Who released it.', key: true, required: true, example: '@seedhe_maut' },
      { header: 'Title', hint: 'Release title.', key: true, required: true, example: 'Lunch Break' },
      { header: 'New title', hint: 'Only to rename a release.', example: '' },
      { header: 'Type', hint: 'album, ep, mixtape or single.', example: 'album' },
      { header: 'Release date', hint: 'YYYY-MM-DD.', example: '2023-08-19' },
      { header: 'Cover URL', hint: 'Image link.', example: '' },
      { header: 'Spotify link', hint: 'Album URL or ID.', example: '' },
    ],
  },
  artists: {
    label: 'Artists',
    note: 'One row per artist. The @handle identifies them; leave it blank on a new artist and one is made from the name.',
    columns: [
      { header: '@handle', hint: 'e.g. @seedhe_maut. Identifies an existing artist.', key: true, example: '@krsna' },
      { header: 'Name', hint: 'Stage name. Required when creating someone new.', key: true, example: 'KR$NA' },
      { header: 'New @handle', hint: 'Only to change an existing handle.', example: '' },
      { header: 'Real name', hint: '', example: 'Krishna Kaul' },
      { header: 'Bio', hint: 'A few lines for their page.', example: '' },
      { header: 'City', hint: 'Must match an existing city, e.g. Delhi.', example: 'Delhi' },
      { header: 'Genres', hint: 'Comma-separated existing genres.', example: 'Boom Bap, Gully Rap' },
      { header: 'Active since', hint: 'Year, e.g. 2006.', example: '2006' },
      { header: 'Instagram', hint: '@handle or profile link.', example: '@krsnamusic' },
      { header: 'YouTube', hint: 'Channel URL.', example: '' },
      { header: 'Spotify', hint: 'Artist URL.', example: '' },
      { header: 'Photo URL', hint: 'Image link (credit goes in the next column).', example: '' },
      { header: 'Photo credit', hint: 'Author / licence, shown on their page.', example: '' },
      { header: 'Producer', hint: 'yes / no — adds the producer badge.', example: 'no' },
    ],
  },
};

/** "Artist @handle" and "artist handle" are the same column. */
export const headerKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const columnByHeader = (kind: SheetKind) => new Map(SHEETS[kind].columns.map((c) => [headerKey(c.header), c]));
