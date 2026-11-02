const STOP = new Set(`a an the and or but if of to in on for with at by from is are was were be been being it its this that these those as i you he she we they my your our their me us them not no so do does did have has had will would can could should just than then there here what when where who why how all any about into over after before up down out more most new now one two get got like via im ive dont doesnt cant wont isnt also very really much many some such only own same too even still yet ever every each other another which while because though although amp http https www com org net html reddit youtube video watch post posts thread comments submitted link
  come comes coming came go goes going went make makes making made take takes taking took say says said see sees seen look looks
  want wants know knows think thinks thing things way ways time times year years day days week today yesterday tomorrow
  first last next back around without within sometime sometimes always never maybe probably actually already almost
  people person someone something anything everything nothing lot lots big small good bad better best worse worst great
  need needs needed use uses used using find finds found give gives gave work works keep keeps let lets put puts
  read full story here's heres there's theres that's thats what's whats it'll you're youre they're theyre we're
  boost help helps show shows shown tell tells told ask asks asked try tries tried call calls called report reports according`.split(/\s+/));

export function tokens(text = '') {
  const words = text.toLowerCase().replace(/https?:\/\/\S+|\b[\w-]+\.(com|org|net|io|co|gov|edu|app|dev)\b\S*/g, ' ').replace(/[’']/g, '').match(/[\p{L}\p{N}][\p{L}\p{N}+#-]*/gu) || [];
  return words.map(w => w.replace(/-+$/, '')).filter(w => w.length > 2 && w.length < 30 && !STOP.has(w) && !/^\d+$/.test(w));
}

const termCache = new Map();
export function matchesTerm(text, term) {
  let rx = termCache.get(term);
  if (!rx) {
    const esc = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    rx = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(s|es)?(?=$|[^\\p{L}\\p{N}])`, 'iu');
    termCache.set(term, rx);
  }
  return rx.test(text);
}

export const itemText = it => `${it.title || ''} ${it.text || ''} ${it.community || ''}`;
