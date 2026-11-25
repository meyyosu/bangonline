'use strict';
// Logic luật chơi Bang! (bản gốc): 80 lá bài, 16 nhân vật, 4 vai trò.

const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const power = require('./power'); // sức mạnh & cán cân cho tab Diễn biến / Đóng góp

const RANKS = { J: 11, Q: 12, K: 13, A: 14 };
const rankVal = (r) => RANKS[r] || Number(r);
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };

const CARD_INFO = {
  'Bang': { type: 'brown', icon: '💥', desc: 'Bắn một người trong tầm súng. Mỗi lượt chỉ được dùng 1 lần.' },
  'Missed': { type: 'brown', icon: '🙅', desc: 'Né một phát Bang! (chỉ dùng khi bị bắn).' },
  'Beer': { type: 'brown', icon: '🍺', desc: 'Hồi 1 máu. Vô dụng khi chỉ còn 2 người. Tự động dùng khi sắp chết.' },
  'Saloon': { type: 'brown', icon: '🥃', desc: 'Mọi người còn sống hồi 1 máu.' },
  'Stagecoach': { type: 'brown', icon: '🐎', desc: 'Rút 2 lá.' },
  'Wells Fargo': { type: 'brown', icon: '💰', desc: 'Rút 3 lá.' },
  'General Store': { type: 'brown', icon: '🏪', desc: 'Lật số lá bằng số người sống, lần lượt mỗi người chọn 1 lá.' },
  'Panic': { type: 'brown', icon: '😱', desc: 'Lấy 1 lá của người ở khoảng cách 1.' },
  'Cat Balou': { type: 'brown', icon: '💃', desc: 'Buộc một người bỏ 1 lá bài.' },
  'Duel': { type: 'brown', icon: '🤠', desc: 'Đấu súng: lần lượt bỏ Bang!, ai không bỏ được thì mất 1 máu.' },
  'Indians': { type: 'brown', icon: '🪶', desc: 'Mọi người khác phải bỏ 1 Bang! hoặc mất 1 máu.' },
  'Gatling': { type: 'brown', icon: '🔫', desc: 'Bắn tất cả người khác (né bằng Missed!).' },
  'Barrel': { type: 'blue', icon: '🛢️', desc: 'Khi bị bắn, rút kiểm tra: ra ♥ thì coi như né.' },
  'Mustang': { type: 'blue', icon: '🐴', desc: 'Người khác nhìn bạn xa thêm 1.' },
  'Scope': { type: 'blue', icon: '🔭', desc: 'Bạn nhìn người khác gần hơn 1.' },
  'Jail': { type: 'blue', icon: '⛓️', desc: 'Đặt lên người khác (trừ Sheriff). Đầu lượt rút kiểm tra: ♥ thì thoát, không thì mất lượt.' },
  'Dynamite': { type: 'blue', icon: '🧨', desc: 'Đầu lượt rút kiểm tra: ♠2–9 thì nổ mất 3 máu, không thì chuyền sang người kế.' },
  'Volcanic': { type: 'gun', range: 1, icon: '🔫', desc: 'Súng tầm 1. Bắn Bang! không giới hạn.' },
  'Schofield': { type: 'gun', range: 2, icon: '🔫', desc: 'Súng tầm 2.' },
  'Remington': { type: 'gun', range: 3, icon: '🔫', desc: 'Súng tầm 3.' },
  'Rev. Carabine': { type: 'gun', range: 4, icon: '🔫', desc: 'Súng tầm 4.' },
  'Winchester': { type: 'gun', range: 5, icon: '🔫', desc: 'Súng tầm 5.' },
};

const CHAR_INFO = {
  'Bart Cassidy': { hp: 4, desc: 'Mỗi khi mất 1 máu, rút 1 lá.' },
  'Black Jack': { hp: 4, desc: 'Khi rút bài đầu lượt, nếu lá thứ 2 là ♥/♦ thì rút thêm 1 lá.' },
  'Calamity Janet': { hp: 4, desc: 'Dùng Bang! như Missed! và ngược lại.' },
  'El Gringo': { hp: 3, desc: 'Mỗi khi bị người khác làm mất 1 máu, lấy ngẫu nhiên 1 lá trên tay người đó.' },
  'Jesse Jones': { hp: 4, desc: 'Lá đầu tiên khi rút bài có thể lấy ngẫu nhiên từ tay một người.' },
  'Jourdonnais': { hp: 4, desc: 'Luôn có sẵn một Barrel.' },
  'Kit Carlson': { hp: 4, desc: 'Khi rút bài: xem 3 lá trên cùng, giữ 2, trả lại 1.' },
  'Lucky Duke': { hp: 4, desc: 'Khi rút kiểm tra, lật 2 lá và lấy lá có lợi.' },
  'Paul Regret': { hp: 3, desc: 'Luôn có Mustang: người khác nhìn bạn xa thêm 1.' },
  'Pedro Ramirez': { hp: 4, desc: 'Lá đầu tiên khi rút bài có thể lấy từ đỉnh chồng bài bỏ.' },
  'Rose Doolan': { hp: 4, desc: 'Luôn có Scope: bạn nhìn người khác gần hơn 1.' },
  'Sid Ketchum': { hp: 4, desc: 'Bỏ 2 lá bất kỳ để hồi 1 máu (bất cứ lúc nào).' },
  'Slab the Killer': { hp: 4, desc: 'Người bị bạn Bang! cần 2 Missed! để né.' },
  'Suzy Lafayette': { hp: 4, desc: 'Khi hết bài trên tay, rút ngay 1 lá.' },
  'Vulture Sam': { hp: 4, desc: 'Khi có người chết, lấy toàn bộ bài của họ.' },
  'Willy the Kid': { hp: 4, desc: 'Được dùng Bang! không giới hạn.' },
};

const DODGE_CITY_CHAR_INFO = {
  'Apache Kid': { hp: 3, desc: 'Miễn nhiễm với các lá chất Rô do người khác đánh vào bạn. Kỹ năng này tạm thời vô hiệu khi đang trong Duel (Đấu súng).' },
  'Belle Star': { hp: 4, desc: 'Trong lượt của bạn, trang bị trên bàn của người khác mất hiệu lực.' },
  'Bill Noface': { hp: 4, desc: 'Đầu lượt rút 1 lá, cộng thêm 1 lá cho mỗi điểm máu đang thiếu.' },
  'Chuck Wengam': { hp: 4, desc: 'Trong lượt, có thể trả 1 máu để rút 2 lá nhiều lần. Không được trả điểm máu cuối.' },
  'Doc Holyday': { hp: 4, desc: 'Mỗi lượt bỏ 2 lá trên tay để bắn một người trong tầm súng. Không tính vào giới hạn Bang!.' },
  'Elena Fuente': { hp: 3, desc: 'Có thể dùng bất kỳ lá trên tay để né một đòn bắn.' },
  'Greg Digger': { hp: 4, desc: 'Khi người khác bị loại, hồi 2 máu, tối đa bằng giới hạn máu.' },
  'Herb Hunter': { hp: 4, desc: 'Khi người khác bị loại, rút thêm 2 lá.' },
  'José Delgado': { hp: 4, desc: 'Tối đa 2 lần mỗi lượt, bỏ 1 lá viền xanh dương trên tay để rút 2 lá.' },
  'Molly Stark': { hp: 4, desc: 'Khi bạn đánh một lá từ tay trong lượt của người chơi khác, bạn được rút 1 lá.' },
  'Pat Brennan': { hp: 4, desc: 'Ở giai đoạn rút bài, bạn có hai lựa chọn. Rút 2 lá từ chồng bài hoặc lấy đúng 1 lá viền xanh dương hay xanh lá đang đặt trước mặt bất kỳ người chơi nào, kể cả bạn.' },
  'Pixie Pete': { hp: 3, desc: 'Đầu lượt rút 3 lá.' },
  'Sean Mallory': { hp: 3, desc: 'Cuối lượt được giữ tối đa 10 lá trên tay.' },
  'Tequila Joe': { hp: 4, desc: 'Beer hồi 2 máu, kể cả khi dùng để sống sót.' },
  'Vera Custer': { hp: 3, desc: 'Trước khi rút, chọn một nhân vật khác còn sống để sao chép kỹ năng đến lượt sau.' },
};
const BASE_CHARACTERS = Object.keys(CHAR_INFO);
Object.assign(CHAR_INFO, DODGE_CITY_CHAR_INFO);

const ROLE_INFO = {
  Sheriff: { vi: 'Cảnh sát trưởng', goal: 'Tiêu diệt tất cả Outlaw và Renegade.' },
  Deputy: { vi: 'Phó cảnh sát', goal: 'Bảo vệ Sheriff, tiêu diệt Outlaw và Renegade.' },
  Outlaw: { vi: 'Kẻ ngoài vòng pháp luật', goal: 'Hạ gục Sheriff.' },
  Renegade: { vi: 'Kẻ phản bội', goal: 'Là người cuối cùng sống sót.' },
};

const ROLE_SETS = {
  4: ['Sheriff', 'Renegade', 'Outlaw', 'Outlaw'],
  5: ['Sheriff', 'Renegade', 'Outlaw', 'Outlaw', 'Deputy'],
  6: ['Sheriff', 'Renegade', 'Outlaw', 'Outlaw', 'Outlaw', 'Deputy'],
  7: ['Sheriff', 'Renegade', 'Outlaw', 'Outlaw', 'Outlaw', 'Deputy', 'Deputy'],
  8: ['Sheriff', 'Renegade', 'Renegade', 'Outlaw', 'Outlaw', 'Outlaw', 'Deputy', 'Deputy'],
};

const RULES_PREVIEW = process.env.BANG_RULES_PREVIEW === '1';

const DECK_SPEC = [
  ['Bang', 'S', 'A'], ['Bang', 'D', '2 3 4 5 6 7 8 9 10 J Q K A'], ['Bang', 'C', '2 3 4 5 6 7 8 9'], ['Bang', 'H', 'Q K A'],
  ['Missed', 'C', '10 J Q K A'], ['Missed', 'S', '2 3 4 5 6 7 8'],
  ['Beer', 'H', '6 7 8 9 10 J'], ['Saloon', 'H', '5'], ['Wells Fargo', 'H', '3'], ['Stagecoach', 'S', '9 9'],
  ['General Store', 'C', '9'], ['General Store', 'S', 'Q'],
  ['Panic', 'H', 'J Q A'], ['Panic', 'D', '8'], ['Cat Balou', 'H', 'K'], ['Cat Balou', 'D', '9 10 J'],
  ['Duel', 'D', 'Q'], ['Duel', 'S', 'J'], ['Duel', 'C', '8'], ['Indians', 'D', 'K A'], ['Gatling', 'H', '10'],
  ['Barrel', 'S', 'Q K'], ['Mustang', 'H', '8 9'], ['Scope', 'S', 'A'], ['Jail', 'S', 'J 10'], ['Jail', 'H', '4'],
  ['Dynamite', 'H', '2'], ['Volcanic', 'S', '10'], ['Volcanic', 'C', '10'], ['Schofield', 'C', 'J Q'],
  ['Schofield', 'S', 'K'], ['Remington', 'C', 'K'], ['Rev. Carabine', 'C', 'A'], ['Winchester', 'S', '8'],
];

const DODGE_CITY_EFFECTS = {
  draw: ['🃏', 'Rút bài.'],
  heal: ['❤️', 'Hồi máu.'],
  dodge: ['🙅', 'Né một đòn bắn.'],
  attack: ['💥', 'Bắn một người.'],
  attackAll: ['💥', 'Bắn tất cả người khác.'],
  take: ['✋', 'Lấy một lá của người khác.'],
  discard: ['🗑️', 'Buộc người khác bỏ một lá.'],
  discardAll: ['🗑️', 'Chọn một lá để bỏ từ mỗi người chơi khác có bài.'],
  healOther: ['❤️', 'Hồi 1 máu cho người chơi khác.'],
  distanceIn: ['🔭', 'Bạn nhìn người khác gần hơn 1.'],
  distanceOut: ['🏚️', 'Người khác nhìn bạn xa thêm 1.'],
};

function loadDodgeCity(override) {
  const filename = override || join(__dirname, 'dodge-city.json');
  try {
    const data = readFileSync(filename);
    const definitions = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(definitions)) throw new Error('Dữ liệu lá bài phải là một mảng.');
    const baseNames = new Set(Object.keys(CARD_INFO).map((name) => name.toLowerCase()));
    const names = new Set();
    const seen = new Set(DECK_SPEC.flatMap(([name, suit, ranks]) => ranks.split(' ').map((rank) => JSON.stringify([name, suit, rank]))));
    const cards = [];
    let greenTypes = 0, greenCount = 0;
    for (const entry of definitions) {
      if (!entry || typeof entry !== 'object') throw new Error('Thông tin lá bài không hợp lệ.');
      const { name, type = 'green', effect, copies, draw = effect === 'draw' ? 1 : 0, heal = 1, maxDistance, discardCost = false } = entry;
      if (typeof name !== 'string' || name !== name.trim() || !name || name.length > 60 || names.has(name.toLowerCase()) ||
          (name in CARD_INFO && !Object.hasOwn(CARD_INFO, name)) || (baseNames.has(name.toLowerCase()) && !Object.hasOwn(CARD_INFO, name))) {
        throw new Error('Tên mỗi loại lá phải hợp lệ và được khai báo một lần.');
      }
      if (!Array.isArray(copies) || !copies.length || copies.some((copy) => !copy || !Object.hasOwn(SUIT_SYMBOL, copy.suit) ||
          typeof copy.rank !== 'string' || !/^(?:[2-9]|10|[JQKA])$/.test(copy.rank))) {
        throw new Error(`Chất hoặc hạng bài không hợp lệ cho ${name}.`);
      }
      names.add(name.toLowerCase());
      const added = [];
      for (const { rank, suit } of copies) {
        const key = JSON.stringify([name, suit, rank]);
        if (seen.has(key)) continue;
        seen.add(key);
        added.push({ name, rank, suit });
      }
      if (baseNames.has(name.toLowerCase())) {
        if (Object.keys(entry).some((key) => key !== 'name' && key !== 'copies')) throw new Error(`Chỉ được thêm bản sao cho ${name}.`);
        cards.push(...added);
        continue;
      }
      const distanceEffect = ['distanceIn', 'distanceOut'].includes(effect);
      if (!Object.hasOwn(DODGE_CITY_EFFECTS, effect) || !['green', 'brown', 'blue'].includes(type) || typeof discardCost !== 'boolean' ||
          distanceEffect !== (type === 'blue') || (discardCost && (type !== 'brown' || effect === 'dodge')) ||
          (type === 'green' && ['discardAll', 'healOther'].includes(effect))) {
        throw new Error(`Hiệu ứng hoặc màu viền không hợp lệ cho ${name}.`);
      }
      const validRange = maxDistance === undefined || (maxDistance === 'weapon'
        ? effect === 'attack'
        : ['attack', 'take', 'discard'].includes(effect) && Number.isInteger(maxDistance) && maxDistance >= 1 && maxDistance <= 7);
      if (!Number.isInteger(draw) || draw < 0 || draw > 3 || (effect === 'draw' && draw === 0) ||
          (draw > 0 && !['draw', 'dodge', 'attack'].includes(effect)) ||
          !Number.isInteger(heal) || heal < 1 || heal > 2 || !validRange) {
        throw new Error(`Tham số hiệu ứng không hợp lệ cho ${name}.`);
      }
      const [icon, description] = DODGE_CITY_EFFECTS[effect];
      let desc = effect === 'draw' ? `Rút ${draw} lá.` : effect === 'heal' ? `Hồi ${heal} máu.` : description;
      if (effect !== 'draw' && draw) desc += ` Rút thêm ${draw} lá.`;
      if (maxDistance === 'weapon') desc += ' Chọn mục tiêu trong tầm súng.';
      else if (maxDistance !== undefined) desc += ` Khoảng cách tối đa ${maxDistance}.`;
      if (discardCost) desc = `Bỏ thêm 1 lá trên tay. ${desc}`;
      CARD_INFO[name] = { type, effect, icon, desc, draw, heal, maxDistance, discardCost, defense: effect === 'dodge', activate: type === 'green' && effect !== 'dodge' };
      if (type === 'green') { greenTypes++; greenCount += added.length; }
      cards.push(...added);
    }
    if (greenTypes !== 13 || greenCount !== 14) throw new Error('Cần đủ 13 loại và 14 lá viền xanh lá.');
    return { cards, greenCount, revision: createHash('sha256').update(data).digest('hex') };
  } catch (error) {
    if (!override && error.code === 'ENOENT') return { cards: [], greenCount: 0, revision: null };
    throw new Error(`Không nạp được dữ liệu Dodge City (${filename}). ${error.message}`);
  }
}

const DODGE_CITY = loadDodgeCity(process.env.BANG_DODGE_CITY_FILE || process.env.BANG_GREEN_CARDS_FILE);

function loadValley() {
  try {
    const bytes = readFileSync(join(__dirname, 'valley-of-shadow.json'));
    const data = JSON.parse(bytes.toString('utf8'));
    const cards = [];
    for (const { name, copies, ...info } of data.cards) {
      if (name in CARD_INFO || !copies.length || copies.some(({ rank, suit }) => !Object.hasOwn(SUIT_SYMBOL, suit) || !/^(?:[2-9]|10|[JQKA])$/.test(rank))) {
        throw new Error(`Tên, hạng hoặc chất không hợp lệ: ${name}.`);
      }
      CARD_INFO[name] = info;
      cards.push(...copies.map((copy) => ({ name, ...copy })));
    }
    Object.assign(CHAR_INFO, data.characters);
    return { cards, characters: Object.keys(data.characters), revision: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    if (error.code === 'ENOENT') return { cards: [], characters: [], revision: null };
    throw new Error(`Không nạp được dữ liệu Valley of Shadow. ${error.message}`);
  }
}
const VALLEY = loadValley();

function buildDeck(dodgeCity, valleyOfShadow) {
  const deck = [];
  let id = 1;
  for (const [name, suit, ranks] of DECK_SPEC) {
    for (const rank of ranks.split(' ')) deck.push({ id: id++, name, suit, rank });
  }
  if (dodgeCity) for (const card of DODGE_CITY.cards) deck.push({ ...card, id: id++ });
  if (valleyOfShadow) for (const card of VALLEY.cards) deck.push({ ...card, id: id++ });
  return deck;
}

const MIN_CHECKS = 3; // Nhân phẩm tốt / Kiếp trước đốt chùa: cần rút kiểm tra ít nhất 3 lần
const numberedSounds = (prefix, count) => Array.from({ length: count }, (_, i) => prefix + (i + 1));
const randomSound = (sounds) => Array.isArray(sounds) ? sounds[Math.floor(Math.random() * sounds.length)] : sounds;
const GUN_SOUNDS = {
  default: numberedSounds('bangsound', 7),
  Schofield: numberedSounds('bangsound_schofield', 3),
  Remington: numberedSounds('bangsound_remington', 3),
  'Rev. Carabine': numberedSounds('bangsound_revcarabine', 3),
  Winchester: numberedSounds('bangsound_winchester', 3),
  LeMat: 'bangsound_lemat',
  Shotgun: 'bangsound_shotgun',
};
const MISSED_SOUNDS = numberedSounds('missedsound', 6);
const IRON_PLATE_SOUNDS = [
  'missedsound_ironplate', 'missedsound_ironplate2', 'missedsound_ironplate3', 'missedsound_ironplate4',
];
const BARREL_SOUND = 'missedsound_barrel';
const STEAL_SOUNDS = ['cardswap', 'cardswap2'];
const TARGET_DISCARD_SOUND = 'catbalou1';
const PROJECTILE_BY_CARD = { Punch: 'fist', Knife: 'knife' };
const HURT_SOUNDS = { female: numberedSounds('hurt_f', 4), male: numberedSounds('hurt_m', 4) };
const FEMALE_CHARACTERS = new Set([
  'Calamity Janet', 'Rose Doolan', 'Suzy Lafayette', 'Belle Star', 'Elena Fuente', 'Molly Stark', 'Vera Custer',
  'Black Flower', 'Evelyn Shebang',
]);
const AIM_SOUNDS = { play: 'Aim', female: 'aim_success_f', male: 'aim_success_m' };
const EFFECT_SOUNDS = {
  backfire: 'backfired', escape: 'escape', draw: 'drawcard', rattlesnakeHurt: 'rattlesnake_hurt',
  bountyPlaced: 'bounty', bountyEarned: 'bounty_earned',
};
const PLAY_SOUNDS = { Punch: 'punch1', Gatling: 'gatling', Howitzer: 'howitzer1', Duel: 'duelo1',
  'General Store': 'generalstore1', Indians: 'indian1',
  'Buffalo Rifle': 'bangsound_buffalorifle', Derringer: 'bangsound_derringer', Pepperbox: 'bangsound_pepperbox',
  Knife: 'bangsound_knife', Springfield: 'bangsound_springfield',
  Bandidos: 'bandidos', Fanning: 'fanning', Poker: 'poker', Tomahawk: 'tomahawk', Tornado: 'tornado',
  Beer: 'beerdrink', Saloon: numberedSounds('saloon', 4), Whisky: numberedSounds('whiskey', 2) };
const EQUIP_SOUNDS = { Mustang: 'mustang1', Dynamite: 'dynamite_start.wav', Jail: 'prison1', Rattlesnake: 'rattlesnake' };
const SOUND_FILES = new Set([
  'bangload', 'playerjoin', 'yourturn1', 'equipment1', 'prisonfree', 'playereliminated', 'outlawkilled1', 'dynamite_explode.wav',
  'victory', 'defeat',
  BARREL_SOUND, TARGET_DISCARD_SOUND, ...MISSED_SOUNDS, ...IRON_PLATE_SOUNDS, ...STEAL_SOUNDS,
  ...Object.values(HURT_SOUNDS).flat(), ...Object.values(GUN_SOUNDS).flat(),
  ...Object.values(AIM_SOUNDS), ...Object.values(EFFECT_SOUNDS),
  ...Object.values(PLAY_SOUNDS).flat(), ...Object.values(EQUIP_SOUNDS),
].map((file) => file.includes('.') ? file : `${file}.mp3`));
const FACTION = { Sheriff: 'law', Deputy: 'law', Outlaw: 'outlaw', Renegade: 'renegade' };
const sameFaction = (a, b) => a !== 'Renegade' && FACTION[a] === FACTION[b]; // Renegade không có đồng đội
const newStats = () => ({
  bangs: 0, dealt: 0, taken: 0, kills: 0, dodged: 0, healed: 0, mass: 0, equips: 0, targeted: 0,
  checks: 0, checksOk: 0, checkExpected: 0, friendly: 0, friendlyTo: {},
  turnDealt: 0, turnDealtAt: 0, bestTurn: 0, bestTurnAt: 0,
  // Lươn chúa: máu tránh được trong cùng một vòng (né Bang!/Gatling, đỡ Indians!, bỏ Bang! trong Duel)
  roundAvoided: 0, roundAvoidedAt: 0, bestAvoid: 0, bestAvoidAt: 0,
  ownTurns: 0, lowTurns: 0,          // Di sản (số lượt của mình), Sống dai (lượt bắt đầu khi ≤ 2 máu)
  takenFrom: {},                     // máu mất theo người gây ra → Đớp mạng
  snatched: 0, snatchedFrom: [],     // Đớp mạng: máu người khác đã cày trên những người mình kết liễu
  teamTargets: 0, teamTargetTo: {},  // Quả tạ vàng: nhắm vào đồng đội
  renegadeTargets: 0,                // Tao biết mà: nhắm vào Renegade
});

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const cardStr = (c) => `${c.name} ${c.rank}${SUIT_SYMBOL[c.suit]}`;

class Game {
  constructor(names, opts = {}) {
    const maxPlayers = opts.dodgeCity ? 8 : 7;
    if (names.length < 4 || names.length > maxPlayers) fail(`Cần 4–${maxPlayers} người chơi.`);
    this.rng = opts.rng || Math.random;
    const roles = shuffle([...ROLE_SETS[names.length]], this.rng);
    const pool = [...BASE_CHARACTERS];
    if (opts.dodgeCity) pool.push(...Object.keys(DODGE_CITY_CHAR_INFO));
    if (opts.valleyOfShadow) pool.push(...VALLEY.characters);
    const chars = shuffle(pool, this.rng);
    const order = shuffle([...names], this.rng);
    this.players = order.map((name, i) => {
      const role = roles[i];
      const char = opts.chars?.[name] || chars[i];
      const maxHp = CHAR_INFO[char].hp + (role === 'Sheriff' ? 1 : 0);
      return { name, role, char, maxHp, hp: maxHp, hand: [], eq: [], coolingGreen: new Set(), alive: true, jailed: 0 };
    });
    if (opts.dodgeCity && !DODGE_CITY.cards.length) fail('Chưa nạp bộ lá Dodge City.');
    if (opts.valleyOfShadow && !VALLEY.cards.length) fail('Chưa nạp bộ lá Valley of Shadow.');
    this.valleyOfShadow = !!opts.valleyOfShadow;
    this.fullDeck = buildDeck(opts.dodgeCity, this.valleyOfShadow); // Dùng bộ bài ban đầu của phòng để tính xác suất rút kiểm tra.
    this.deck = shuffle([...this.fullDeck], this.rng);
    this.discard = [];
    this.log = [];
    this.sounds = [];
    this.soundSeq = 0;
    this.combatEffects = [];
    this.queue = [];
    this.pending = null;
    this.winner = null;
    this.bangsPlayed = 0;
    this.phase = 'start';
    this.turn = this.players.findIndex((p) => p.role === 'Sheriff');
    this.stats = this.players.map(() => newStats());
    this.bandits = []; // Tướng cướp: các Outlaw theo thứ tự lần đầu nhắm vào Sheriff
    const choices = opts.characterChoices ?? 1;
    if (!Number.isInteger(choices) || choices < 1 || choices > 4) fail('Số nhân vật để chọn phải từ 1 đến 4.');
    if (choices > 1) {
      this.characterChoices = choices;
      this.characterPool = chars;
      for (const p of this.players) { p.char = null; p.hp = 0; p.maxHp = 0; }
      this.phase = 'character';
      // Sheriff (đã lộ vai trò) chọn trước, rồi lần lượt theo chiều lượt chơi.
      this.offerCharacters(this.turn);
    } else this.beginGame();
  }

  offerCharacters(player) {
    this.pending = { type: 'character', player, options: shuffle([...this.characterPool], this.rng).slice(0, this.characterChoices) };
  }

  chooseCharacter(pi, character) {
    const pend = this.pending;
    if (pend.player !== pi || !pend.options.includes(character)) fail('Lựa chọn nhân vật không hợp lệ.');
    const p = this.players[pi];
    p.char = character;
    p.maxHp = CHAR_INFO[character].hp + (p.role === 'Sheriff' ? 1 : 0);
    p.hp = p.maxHp;
    this.characterPool = this.characterPool.filter((c) => c !== character);
    this.addLog(`${p.name} đã chọn ${character}.`);
    const next = (pi + 1) % this.players.length;
    if (next !== this.turn) this.offerCharacters(next);
    else {
      this.pending = null;
      this.characterPool = null;
      this.beginGame();
    }
  }

  beginGame() {
    this.phase = 'start';
    this.startedAt = Date.now();
    for (const p of this.players) p.hand.push(...this.draw(p.hp));
    this.addLog(`Ván đấu bắt đầu! Sheriff là ${this.players[this.turn].name}.`);
    // Dòng thời gian cán cân: mốc đầu ván (sức mạnh mỗi phe lúc này là chuẩn để so) rồi mỗi hành động một điểm
    this.timeline = [];
    this.tlLog = [];
    power.balance(this, CARD_INFO);
    this.tlStart = this.players.map((p, i) => this.powerState(i));
    this.startTurn();
  }

  // ---------- dòng thời gian cán cân (tab Diễn biến / Đóng góp) ----------
  powerState(i) {
    const p = this.players[i];
    return [p.hp, p.alive ? 1 : 0, Math.round(power.strength(this, i, CARD_INFO) * 10) / 10, p.eq.map((c) => c.name).join('|')];
  }
  // Ai được ghi công cho hành động sắp làm: phản hồi khi bị tấn công → người tấn công; Duel → đối thủ;
  // rút kiểm tra Dynamite/Jail → không ai (-1, "Số phận"); còn lại → chính người làm.
  creditFor(pi) {
    const pend = this.pending;
    if (!pend || pend.player !== pi) return pi;
    if (pend.type === 'check') return pend.kind === 'Barrel' && pend.resume ? (pend.resume.source ?? -1) : -1;
    if (pend.type === 'duel') return pend.other ?? pi;
    if (pend.source != null && pend.source !== pi) return pend.source;
    return pi;
  }
  recordTimeline(credit) {
    if (!this.timeline || this.phase === 'character') return;
    this.timeline.push({
      t: this.turnNumber || 0, r: this.roundNumber || 0, o: this.turn, a: credit,
      b: Math.round(power.balance(this, CARD_INFO) * 1000) / 1000,
      ps: this.players.map((_, i) => this.powerState(i)), log: this.tlLog.splice(0),
    });
  }

  // ---------- tiện ích ----------
  addLog(msg) { this.log.push(msg); if (this.log.length > 150) this.log.shift(); if (this.tlLog) this.tlLog.push(msg); }
  idx(name) { return this.players.findIndex((p) => p.name === name); }
  alive() { return this.players.map((p, i) => i).filter((i) => this.players[i].alive); }
  nextAlive(i) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (this.players[j].alive) return j; }
    return i;
  }
  draw(n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      if (!this.deck.length) {
        if (this.discard.length <= 1) break;
        const top = this.discard.pop();
        this.deck = shuffle(this.discard, this.rng);
        this.discard = [top];
        this.addLog('Chồng bài đã được xáo lại.');
      }
      out.push(this.deck.pop());
    }
    return out;
  }
  recordTransfer(p, cards, from = 'deck', destination = null, publicCards = false, slots = null, sourceZone = null) {
    if (!cards.length) return;
    const owner = this.idx(p.name);
    this.transferSeq = (this.transferSeq || 0) + 1;
    this.transfers = [...(this.transfers || []), { seq: this.transferSeq, to: destination ?? owner, owner, from, cards, publicCards, slots, sourceZone }].slice(-40);
    if (destination === null && (from === 'deck' || from === 'kit')) this.recordSound(EFFECT_SOUNDS.draw, owner);
  }
  give(p, n) {
    const cards = this.draw(n);
    p.hand.push(...cards);
    this.recordTransfer(p, cards);
    return cards.length;
  }
  recordPlay(player, card, kind = 'play') {
    const recipient = this.players.findIndex((p) => p.eq.some((c) => c.id === card.id));
    this.playSeq = (this.playSeq || 0) + 1;
    this.plays = [...(this.plays || []), { seq: this.playSeq, player, card, recipient: recipient < 0 ? null : recipient, kind }].slice(-40);
    return recipient;
  }
  recordSound(files, player = null) {
    this.sounds.push({ seq: ++this.soundSeq, files: Array.isArray(files) ? files : [files], player });
    if (this.sounds.length > 40) this.sounds.shift();
  }
  recordCombatEffect(effect) {
    const seq = (this.combatEffects.at(-1)?.seq ?? 0) + 1;
    this.combatEffects.push({ seq, ...effect });
    if (this.combatEffects.length > 40) this.combatEffects.shift();
  }
  toDiscard(...cards) { this.discard.push(...cards); }
  ability(p) { return p.char === 'Vera Custer' ? p.copiedAbility : p.char; }
  handLimit(p) { return p.ghost ? 0 : this.ability(p) === 'Sean Mallory' ? 10 : p.hp; }
  canHeal(p) { return !p.ghost && p.hp < p.maxHp; }
  beerHealing(p) { return this.ability(p) === 'Tequila Joe' ? 2 : 1; }
  equipmentActive(p) {
    const current = this.players[this.turn];
    return p === current || this.ability(current) !== 'Belle Star';
  }
  ignoresDiamonds(p) { return this.ability(p) === 'Apache Kid'; }
  ignoredCard(p, card) {
    if (card.suit !== 'D' || !this.ignoresDiamonds(p)) return false;
    this.addLog(`${p.name} miễn hiệu ứng ${card.name} chất Rô.`);
    return true;
  }
  isBlue(c) { return ['blue', 'gun'].includes(CARD_INFO[c.name].type); }
  hasEq(p, name) { return p.eq.some((c) => c.name === name); }
  gun(p) { return p.eq.find((c) => CARD_INFO[c.name].type === 'gun'); }
  range(p) { const g = this.gun(p); return g && this.equipmentActive(p) ? CARD_INFO[g.name].range : 1; }
  unlimitedBang(p) { return this.ability(p) === 'Willy the Kid' || (this.equipmentActive(p) && this.gun(p)?.name === 'Volcanic'); }
  barrelCount(p) { return (this.equipmentActive(p) && this.hasEq(p, 'Barrel') ? 1 : 0) + (this.ability(p) === 'Jourdonnais' ? 1 : 0); }
  attackPrompt(source, player, need) {
    return { type: 'bang', source, player, need, got: 0, barrels: this.barrelCount(this.players[player]) };
  }
  dodgeCards(p) {
    const skill = this.ability(p);
    const hand = p.hand.filter((c) => skill === 'Elena Fuente' || ['Missed', 'Dodge', 'Backfire'].includes(c.name) || (c.name === 'Bang' && skill === 'Calamity Janet'));
    const equipment = this.equipmentActive(p) ? p.eq.filter((c) => CARD_INFO[c.name].defense && !p.coolingGreen.has(c.id)) : [];
    return [...hand, ...equipment];
  }
  distance(a, b) {
    if (a === b) return 0;
    const al = this.alive();
    const ia = al.indexOf(a), ib = al.indexOf(b);
    if (ia < 0 || ib < 0) return null;
    const d = Math.abs(ia - ib);
    let dist = Math.min(d, al.length - d);
    const pa = this.players[a], pb = this.players[b];
    if (this.equipmentActive(pb)) dist += Number(this.hasEq(pb, 'Mustang')) + pb.eq.filter((c) => CARD_INFO[c.name].effect === 'distanceOut').length;
    if (this.ability(pb) === 'Paul Regret') dist++;
    if (this.equipmentActive(pa)) dist -= Number(this.hasEq(pa, 'Scope')) + pa.eq.filter((c) => CARD_INFO[c.name].effect === 'distanceIn').length;
    if (this.ability(pa) === 'Rose Doolan') dist--;
    return Math.max(1, dist);
  }
  takeFromHand(p, cardId) {
    const i = p.hand.findIndex((c) => c.id === cardId);
    if (i < 0) fail('Bạn không có lá bài này.');
    return p.hand.splice(i, 1)[0];
  }
  targetCard(p, selection) {
    if (selection === 'hand') {
      if (!p.hand.length) fail('Người này không có bài trên tay.');
      return null; // Chỉ lật lá ngẫu nhiên sau khi đã xác thực cả hành động.
    }
    const card = p.eq.find((c) => c.id === selection);
    if (!card) fail('Hãy chọn một lá bài của người đó.');
    return card;
  }
  removeTargetCard(p, card) {
    if (!card) return p.hand.splice(Math.floor(this.rng() * p.hand.length), 1)[0];
    p.eq.splice(p.eq.indexOf(card), 1);
    p.coolingGreen.delete(card.id);
    if (card.name === 'Ghost') this.dismissGhost(p);
    return card;
  }
  stealRandom(from, to) {
    if (!from.hand.length) return null;
    const c = from.hand.splice(Math.floor(this.rng() * from.hand.length), 1)[0];
    to.hand.push(c);
    this.recordTransfer(to, [c], this.idx(from.name));
    this.recordSound(randomSound(STEAL_SOUNDS));
    return c;
  }
  // "Rút kiểm tra" (Draw!). Kết quả lần rút gần nhất lưu ở lastCheck để giao diện lật bài cho mọi người xem.
  check(p, success, label) {
    const luckyDuke = this.ability(p) === 'Lucky Duke';
    const cards = this.draw(luckyDuke ? 2 : 1);
    const chosen = cards.find(success) || cards[0];
    this.toDiscard(...cards);
    const ok = !!chosen && success(chosen);
    const pi = this.idx(p.name);
    if (cards.length) this.recordSound(EFFECT_SOUNDS.draw, pi);
    const st = this.stats[pi];
    const chance = this.fullDeck.filter(success).length / this.fullDeck.length;
    st.checks++; if (ok) st.checksOk++;
    st.checkExpected += luckyDuke ? 1 - (1 - chance) ** 2 : chance;
    this.addLog(`${p.name} rút kiểm tra (${label}): ${cards.map(cardStr).join(', ')} → ${ok ? 'thành công' : 'thất bại'}.`);
    this.checkSeq = (this.checkSeq || 0) + 1;
    this.lastCheck = { seq: this.checkSeq, player: pi, kind: label, cards, chosen: chosen ? chosen.id : null, ok };
    return ok;
  }
  // Chờ người chơi tự bấm rút kiểm tra; resume = pending 'bang' cần quay lại sau khi rút Barrel
  askCheck(pi, kind, resume = null) {
    this.pending = { type: 'check', player: pi, kind, resume };
  }

  // ---------- lượt chơi ----------
  startTurn() {
    if (this.winner) return;
    this.turnNumber = (this.turnNumber || 0) + 1;
    const pi = this.turn, p = this.players[pi];
    // Vòng = từ lượt Sheriff tới trước lượt Sheriff kế tiếp (ván luôn mở bằng Sheriff; Sheriff chết là hết ván)
    if (p.role === 'Sheriff') this.roundNumber = (this.roundNumber || 0) + 1;
    this.stats[pi].ownTurns++;
    if (p.hp <= 2) this.stats[pi].lowTurns++;
    p.coolingGreen.clear();
    if (p.char === 'Vera Custer') p.copiedAbility = null;
    this.bangsPlayed = 0;
    this.skillUses = 0;
    this.phase = 'start';
    this.addLog(`— Lượt của ${p.name} —`);
    this.recordSound('yourturn1', pi);
    this.continueTurnStart();
  }

  // Đầu lượt: lần lượt chờ rút kiểm tra Dynamite rồi Jail, sau đó mới tới bước rút bài
  continueTurnStart(checkDynamite = true, checkSnake = true) {
    const pi = this.turn, p = this.players[pi];
    if (checkDynamite && this.hasEq(p, 'Dynamite')) return this.askCheck(pi, 'Dynamite');
    if (p.eq.some((c) => c.name === 'Jail')) return this.askCheck(pi, 'Jail');
    if (checkSnake && this.hasEq(p, 'Rattlesnake')) return this.askCheck(pi, 'Rattlesnake');
    if (p.char === 'Vera Custer') {
      this.phase = 'draw';
      this.pending = { type: 'copyAbility', player: pi };
      return;
    }
    this.beginDraw();
  }

  resolveCheck(pi, p, pend) {
    if (pend.kind !== 'Barrel' && !this.hasEq(p, pend.kind)) {
      this.pending = null;
      return this.continueTurnStart(false, pend.kind !== 'Rattlesnake');
    }
    if (pend.kind === 'Dynamite') {
      const dyn = p.eq.find((c) => c.name === 'Dynamite');
      const safe = this.check(p, (c) => !(c.suit === 'S' && rankVal(c.rank) >= 2 && rankVal(c.rank) <= 9), 'Dynamite');
      this.pending = null;
      p.eq.splice(p.eq.indexOf(dyn), 1);
      if (!safe) {
        this.addLog(`💥 Dynamite nổ! ${p.name} mất 3 máu.`);
        this.recordSound('dynamite_explode.wav');
        this.toDiscard(dyn);
        return this.turnStartDamage(pi, 3, true);
      } else {
        let next = this.nextAlive(pi);
        while (next !== pi && this.hasEq(this.players[next], 'Dynamite')) next = this.nextAlive(next);
        const nx = this.players[next];
        nx.eq.push(dyn);
        if (next !== pi) this.recordSound(EQUIP_SOUNDS.Dynamite);
        this.addLog(next === pi ? `Dynamite vẫn ở trước ${p.name}.` : `Dynamite được chuyền sang ${nx.name}.`);
      }
      return this.continueTurnStart(false);
    }
    if (pend.kind === 'Rattlesnake') {
      const safe = this.check(p, (c) => c.suit !== 'S', 'Rattlesnake');
      this.pending = null;
      if (!safe) return this.turnStartDamage(pi, 1, false, EFFECT_SOUNDS.rattlesnakeHurt);
      return this.continueTurnStart(false, false);
    }
    if (pend.kind === 'Jail') {
      const jail = p.eq.find((c) => c.name === 'Jail');
      const free = this.check(p, (c) => c.suit === 'H', 'Jail');
      this.pending = null;
      p.eq.splice(p.eq.indexOf(jail), 1);
      this.toDiscard(jail);
      p.jailed = 0; // đã rút kiểm tra: bỏ song sắt dù thoát hay không
      if (!free) {
        this.addLog(`${p.name} bị giam, mất lượt.`);
        return this.nextTurn();
      }
      this.addLog(`${p.name} thoát khỏi nhà tù!`);
      this.recordSound('prisonfree');
      return this.continueTurnStart(false);
    }
    // Barrel: rút xong thì quay lại phát Bang! đang chờ
    const bang = pend.resume;
    if (this.check(p, (c) => c.suit === 'H', 'Barrel')) {
      bang.got++;
      this.stats[pi].dodged++;
      this.recordSound(BARREL_SOUND);
      if (bang.got >= bang.need) this.noteAvoid(pi);
    }
    if (bang.got >= bang.need) { this.addLog(`${p.name} đã né được!`); this.noteMass(bang, { barrel: true }); return this.finishResponse(bang); }
    this.pending = bang;
  }

  beginDraw() {
    const pi = this.turn, p = this.players[pi];
    this.phase = 'draw';
    const skill = this.ability(p);
    const options = ['deck'];
    if (skill === 'Jesse Jones' && this.alive().some((i) => i !== pi && this.players[i].hand.length)) options.push('player');
    if (skill === 'Pedro Ramirez' && this.discard.length) options.push('discard');
    if (skill === 'Pat Brennan' && this.players.some((q) => q.alive && q.eq.length)) options.push('equipment');
    if (skill === 'Evelyn Shebang' && this.alive().some((i) => i !== pi && this.distance(pi, i) <= this.range(p))) options.push('evelyn');
    this.pending = { type: 'draw', player: pi, options };
  }

  turnStartDamage(pi, amount, checkSnake, hitSound = null) {
    const taken = this.stats[pi].taken;
    this.resolveDamage(pi, amount, null, null, () => {
      if (hitSound && this.stats[pi].taken > taken) this.recordSound(hitSound);
      this.queue.push({ run: () => {
        if (!this.players[pi].alive) this.nextTurn();
        else this.continueTurnStart(false, checkSnake);
      } });
      this.nextPending();
    });
  }

  normalDraw(p) {
    const skill = this.ability(p);
    const n = skill === 'Bill Noface' ? 1 + p.maxHp - p.hp : skill === 'Pixie Pete' ? 3
      : skill === 'Tuco Franziskaner' && !p.eq.some((c) => this.isBlue(c)) ? 4 : 2;
    const cards = this.draw(n);
    p.hand.push(...cards);
    this.addLog(`${p.name} rút ${cards.length} lá.`);
    if (skill === 'Black Jack' && cards[1]) {
      const red = cards[1].suit === 'H' || cards[1].suit === 'D';
      this.recordTransfer(p, cards.slice(0, 1));
      this.drawStageSeq = (this.drawStageSeq || 0) + 1;
      this.pending = { type: 'blackJack', player: this.idx(p.name), card: cards[1], red, stage: this.drawStageSeq };
      this.addLog(`${p.name} lật lá thứ hai trong 3 giây: ${cardStr(cards[1])}${red ? ' → sẽ rút thêm 1 lá!' : ''}`);
      return;
    }
    this.recordTransfer(p, cards);
    this.phase = 'play';
  }

  nextTurn() {
    const player = this.players[this.turn];
    if (player.ghost) {
      const gear = player.eq.filter((card) => card.name !== 'Ghost');
      const dropped = [...player.hand, ...gear];
      this.toDiscard(...dropped);
      for (const card of dropped) this.recordPlay(this.turn, card, 'discard');
      player.hand = [];
      player.eq = player.eq.filter((card) => card.name === 'Ghost');
      player.coolingGreen.clear();
      player.jailed = 0;
    }
    this.pending = null;
    this.queue = [];
    if (this.winner) return;
    this.turn = this.nextAlive(this.turn);
    this.startTurn();
  }

  // ---------- máu, chết, thắng ----------
  damage(ti, amount, src, response = null) {
    const t = this.players[ti];
    if (!t.alive || t.ghost || amount <= 0) return;
    const lost = Math.min(amount, Math.max(t.hp, 0));
    this.recordDamage(ti, lost, src);
    t.hp -= amount;
    if (lost > 0) this.recordCombatEffect({ type: 'damage', player: ti, amount: lost });
    if (response?.aim && lost === 2) {
      const voice = FEMALE_CHARACTERS.has(this.players[src]?.char) ? 'female' : 'male';
      this.recordSound(AIM_SOUNDS[voice]);
    }
    this.addLog(`${t.name} mất ${amount} máu (còn ${Math.max(t.hp, 0)}).`);
    if (t.hp <= 0) this.trySave(t, response);
    if (t.hp <= 0) return this.kill(ti, src);
    this.recordSound(randomSound(FEMALE_CHARACTERS.has(t.char) ? HURT_SOUNDS.female : HURT_SOUNDS.male));
    if (this.ability(t) === 'Bart Cassidy') { this.give(t, amount); this.addLog(`${t.name} rút ${amount} lá (Bart Cassidy).`); }
    if (this.ability(t) === 'El Gringo' && src != null && src !== ti) {
      for (let k = 0; k < amount; k++) {
        if (this.stealRandom(this.players[src], t)) this.addLog(`${t.name} lấy 1 lá từ tay ${this.players[src].name} (El Gringo).`);
      }
    }
  }

  trySave(t, response) {
    while (t.hp <= 0) {
      const beer = t.hand.find((c) => c.name === 'Beer');
      if (beer && this.alive().length > 2) {
        t.hand.splice(t.hand.indexOf(beer), 1);
        this.toDiscard(beer);
        const heal = Math.min(t.maxHp - t.hp, this.beerHealing(t));
        t.hp += heal;
        this.stats[this.idx(t.name)].healed += heal;
        this.addLog(`🍺 ${t.name} uống Beer để sống sót!`);
        this.recordSound(PLAY_SOUNDS.Beer);
        this.mollyDraw(t, response);
        this.offerLemonade(t);
      } else if (this.ability(t) === 'Sid Ketchum' && t.hand.length >= 2) {
        this.toDiscard(...t.hand.splice(0, 2));
        t.hp++;
        this.addLog(`${t.name} bỏ 2 lá để hồi 1 máu (Sid Ketchum).`);
      } else break;
    }
  }

  mollyDraw(p, response = null) {
    const pi = this.idx(p.name);
    if (pi === this.turn || this.ability(p) !== 'Molly Stark') return;
    if (response) this.deferResponseDraw(response, pi, 1);
    else this.give(p, 1);
  }

  deferResponseDraw(response, player, count) {
    const draws = response.deferredDraws ??= new Map();
    draws.set(player, (draws.get(player) || 0) + count);
  }

  finishResponseDraws(response) {
    for (const [i, count] of response.deferredDraws || []) {
      if (this.players[i].alive && !this.winner) this.give(this.players[i], count);
    }
  }

  forfeit(name) {
    const pi = this.idx(name);
    if (pi < 0 || this.winner) return;
    if (this.phase === 'character') fail('Chưa bắt đầu ván đấu.');
    this.players[pi].forfeited = true;
    if (!this.players[pi].alive) return;
    this.addLog(`${name} đã rời phòng và bỏ cuộc.`);
    const cancel = (q) => q && ((q.type === 'duel' && q.other === pi) || (q.player === pi && q.type !== 'store'));
    this.queue = this.queue.filter((q) => {
      if (!cancel(q)) return true;
      this.toDiscard(...(q.cards || []));
      return false;
    });
    const pend = this.pending;
    if (pend?.type === 'store') {
      pend.order = pend.order.filter((i) => i !== pi);
      if (!pend.order.length) {
        this.toDiscard(...pend.cards);
        this.nextPending();
      } else pend.player = pend.order[0];
    } else if (pend?.type === 'saved' && pend.player === pi) {
      this.resolveSaved(pi, this.players[pi], pend, { type: 'take' });
      if (this.winner) return;
    } else if (cancel(pend)) {
      this.toDiscard(...(pend.cards || []));
      this.nextPending();
    }
    const inFlight = [this.pending, ...this.queue];
    this.kill(pi, null);
    if (pend?.type === 'duel' && cancel(pend)) this.finishResponseDraws(pend);
    // Victory clears pending choices; keep any revealed cards in the deck count.
    if (this.winner) for (const q of inFlight) this.toDiscard(...(q?.cards || []));
    else this.afterAction();
  }

  kill(ti, src) {
    const t = this.players[ti];
    if (t.ghost) return this.dismissGhost(t);
    if (src != null && src !== ti) {
      const st = this.stats[src];
      st.kills++;
      // Đớp mạng: phần máu nạn nhân đã mất do người khác (không tính người kết liễu, không tính Dynamite)
      const others = Object.entries(this.stats[ti].takenFrom).reduce((n, [k, v]) => (Number(k) === src ? n : n + v), 0);
      if (others > 0) { st.snatched += others; st.snatchedFrom.push(ti); }
    }
    t.alive = false;
    t.hp = 0;
    this.addLog(`☠️ ${t.name} đã chết! Vai trò: ${t.role} (${ROLE_INFO[t.role].vi}).`);
    this.dropEliminatedCards(t);

    const won = this.checkWin();
    const sounds = ['playereliminated'];
    if (!won && src != null && src !== ti && this.players[src].alive) {
      const k = this.players[src];
      if (t.role === 'Outlaw') {
        const before = k.hand.length;
        this.give(k, 3);
        if (k.hand.length - before === 3) sounds.push('outlawkilled1');
        this.addLog(`${k.name} được thưởng 3 lá vì hạ một Outlaw.`);
      }
      if (t.role === 'Deputy' && k.role === 'Sheriff') {
        this.toDiscard(...k.hand, ...k.eq);
        k.hand = []; k.eq = [];
        this.addLog(`Sheriff ${k.name} lỡ tay giết Phó cảnh sát, phải bỏ toàn bộ bài!`);
      }
    }
    this.recordSound(sounds);
    if (won) {
      this.players.forEach((p, i) => this.recordSound(this.isWinner(p) ? 'victory' : 'defeat', i));
    }
    this.onElimination();
  }

  dropEliminatedCards(t) {
    const ti = this.idx(t.name);
    const looters = this.players.map((_, n) => this.players[(ti + 1 + n) % this.players.length])
      .filter((p) => p.alive && this.ability(p) === 'Vulture Sam');
    const cards = [...(looters.length > 1 ? shuffle(t.hand, this.rng) : t.hand), ...t.eq];
    t.hand = []; t.eq = [];
    if (looters.length && cards.length) {
      cards.forEach((card, i) => looters[i % looters.length].hand.push(card));
      this.addLog(`${looters.map((p) => p.name).join(', ')} nhặt bài của ${t.name} (Vulture Sam).`);
    } else this.toDiscard(...cards);
  }

  onElimination() {
    for (const [i, p] of this.players.entries()) {
      if (!p.alive) continue;
      const skill = this.ability(p);
      if (skill === 'Greg Digger' && this.canHeal(p)) {
        const heal = Math.min(p.maxHp - p.hp, 2);
        p.hp += heal;
        this.stats[i].healed += heal;
      }
      if (skill === 'Herb Hunter') this.give(p, 2);
    }
  }

  dismissGhost(p) {
    p.ghost = false;
    p.alive = false;
    this.dropEliminatedCards(p);
    p.coolingGreen.clear();
    p.jailed = 0;
    this.addLog(`👻 ${p.name} rời bàn khi mất lá Ghost.`);
    if (this.checkWin()) {
      this.players.forEach((player, i) => this.recordSound(this.isWinner(player) ? 'victory' : 'defeat', i));
    }
    this.onElimination();
  }

  checkWin() {
    const al = this.alive().map((i) => this.players[i]);
    const sheriffAlive = al.some((p) => p.role === 'Sheriff');
    if (!sheriffAlive) {
      this.winner = al.length === 1 && al[0].role === 'Renegade' ? 'Renegade' : 'Outlaw';
    } else if (!al.some((p) => p.role === 'Outlaw' || p.role === 'Renegade')) {
      this.winner = 'Sheriff';
    }
    if (this.winner) {
      this.pending = null; this.queue = []; this.phase = 'over';
      this.endedAt = Date.now();
      const msg = { Sheriff: 'Phe Sheriff (Sheriff + Deputy) chiến thắng!', Outlaw: 'Phe Outlaw chiến thắng!', Renegade: 'Renegade chiến thắng!' };
      this.addLog(`🏆 ${msg[this.winner]}`);
    }
    return !!this.winner;
  }

  isWinner(p) {
    if (!this.winner) return false;
    if (this.winner === 'Sheriff') return p.role === 'Sheriff' || p.role === 'Deputy';
    if (this.winner === 'Renegade') return p.role === 'Renegade' && p.alive;
    return p.role === this.winner;
  }

  // Ghi cách một người phản hồi lá đánh chung (Indians/Gatling) để giao diện hiện pop-up kết quả
  noteMass(pend, res) {
    const m = this.mass;
    if (!m || !pend?.mass || pend.mass !== m.seq) return;
    const t = m.targets.find((x) => x.i === pend.player);
    if (!t || t.res) return;
    if (res.hurt && !this.players[pend.player].alive) res = { dead: true };
    t.res = res;
    m.t = Date.now();
  }

  // ---------- hàng đợi phản hồi ----------
  nextPending() {
    this.pending = null;
    while (!this.winner && this.queue.length) {
      const q = this.queue.shift();
      if (q.run) q.run();
      else if (this.players[q.player].alive) this.pending = q;
      if (this.pending) break;
    }
  }

  bangCard(p, card) {
    return card.name === 'Bang' || (card.name === 'Missed' && this.ability(p) === 'Calamity Janet');
  }

  hasLeMat(p) { return this.equipmentActive(p) && this.gun(p)?.name === 'LeMat'; }

  fanningTargets(source, target) {
    return this.alive().filter((i) => i !== source && i !== target && this.distance(target, i) === 1);
  }

  offerLemonade(beerUser) {
    for (const i of this.alive()) {
      const p = this.players[i];
      if (p !== beerUser && this.ability(p) === 'Lemonade Jim' && this.canHeal(p) && p.hand.length) {
        this.queue.push({ type: 'lemonade', player: i });
      }
    }
  }

  beforeRemoval(actor, target, apply) {
    if (actor === target || this.ability(this.players[target]) !== 'Henry Block') return apply();
    this.queue.unshift({ run: () => { if (this.players[actor].alive && this.players[target].alive) apply(); } });
    this.startShot(target, actor);
  }

  escapeCards(p) {
    return p.hand.filter((c) => c.name === 'Escape' || (this.ability(p) === 'Mick Defender' && c.name === 'Missed'));
  }

  applyBrown(source, player, name, apply) {
    if (!this.players[player].alive || this.winner) return;
    if (this.escapeCards(this.players[player]).length) {
      this.pending = { type: 'avoid', source, player, name, apply, canEscape: true };
    } else apply();
  }

  startShot(source, target, { projectile = 'bullet', trueBang = false, amount = 1, canEscape = false, aim = false } = {}) {
    const p = this.players[source];
    if (!p.alive || !this.players[target].alive || this.winner) return;
    const need = trueBang && amount === 1 && this.ability(p) === 'Slab the Killer' ? 2 : 1;
    const shot = { ...this.attackPrompt(source, target, need), amount, trueBang, canEscape, aim };
    this.pending = shot;
    this.recordCombatEffect({ type: 'shot', source, target, projectile });
    if (trueBang && this.ability(p) === 'Colorado Bill' && this.check(p, (c) => c.suit === 'S', 'Colorado Bill')) {
      this.takeShot(shot);
    }
  }

  takeShot(shot) {
    const target = this.players[shot.player], source = this.players[shot.source];
    const bounty = this.equipmentActive(target) && this.hasEq(target, 'Bounty');
    this.resolveDamage(shot.player, shot.amount ?? 1, shot.source, shot, (amount) => {
      this.noteMass(shot, target.ghost ? { ghost: true } : amount ? { hurt: amount } : { saved: true });
      if (amount > 0 && shot.trueBang && source.alive && !this.winner) {
        if (bounty && this.give(source, 1)) this.recordSound(EFFECT_SOUNDS.bountyEarned);
        if (target.alive && target.hand.length && this.equipmentActive(source) && this.gun(source)?.name === 'Shotgun') {
          this.queue.unshift({ type: 'valleyDiscard', player: shot.player, name: 'Shotgun', count: 1 });
        }
      }
      this.finishResponse(shot);
    });
  }

  resolveDamage(player, amount, source, response, done) {
    const target = this.players[player];
    if (target.ghost || !target.alive || amount <= 0) return done(0);
    const savers = this.alive().filter((i) => i !== player && this.hasSaved(this.players[i]));
    const save = { target: player, amount, source, response, done, savers, saves: [] };
    if (response?.immediateSave) {
      const { player: saver, card, from } = response.immediateSave;
      this.playSaved(save, saver, card, from);
      save.savers = save.savers.filter((i) => i !== saver);
    }
    save.player = save.savers.shift();
    this.continueSave(save);
  }

  hasSaved(player) { return player.hand.some((c) => c.name === 'Saved!'); }

  continueSave(save) {
    if (save.amount > 0 && save.player !== undefined) {
      this.pending = { ...save, type: 'saved' };
      return;
    }
    const target = this.players[save.target];
    this.damage(save.target, save.amount, save.source, save.response);
    for (const { i, from } of save.saves) {
      const player = this.players[i];
      const duel = ['bang', 'duel'].includes(save.response?.type);
      if (target.alive) this.addLog(`${player.name} vừa cứu ${target.name} khỏi ${duel ? 'một pha đấu súng' : 'mất 1 máu'}!`);
      else this.addLog(`${player.name} đã chặn 1 sát thương cho ${target.name}.`);
      if (!target.alive || !player.alive || this.winner) continue;
      if (from === 'hand') {
        this.stealRandom(target, player);
        this.stealRandom(target, player);
      } else this.give(player, 2);
    }
    save.done(save.amount);
  }

  resolveSaved(pi, p, pend, a) {
    if (a.type !== 'take') {
      const card = p.hand.find((c) => c.id === a.cardId && c.name === 'Saved!');
      if (a.type !== 'saved' || !card || !['hand', 'deck'].includes(a.from)) fail('Chọn một lá Saved! và nơi rút bài.');
      this.playSaved(pend, pi, card, a.from);
    }
    pend.player = pend.savers.find((i) => this.players[i].alive && this.hasSaved(this.players[i]));
    if (pend.player !== undefined) pend.savers = pend.savers.slice(pend.savers.indexOf(pend.player) + 1);
    this.continueSave(pend);
  }

  playSaved(save, pi, card, from) {
    const p = this.players[pi];
    this.toDiscard(this.takeFromHand(p, card.id));
    this.recordPlay(pi, card);
    this.mollyDraw(p, save.response);
    save.amount--;
    save.saves.push({ i: pi, from });
  }

  savedReaction(pend, pi) {
    const response = pend?.type === 'check' ? pend.resume : pend;
    if (!response || !['bang', 'indians', 'duel'].includes(response.type) || response.player === pi) return null;
    const target = this.players[response.player];
    return target.alive && !target.ghost ? response : null;
  }

  takeResponse(pend) {
    if (pend.type === 'bang') return this.takeShot(pend);
    this.resolveDamage(pend.player, 1, pend.type === 'duel' ? pend.other : pend.source, pend, (amount) => {
      const ghost = this.players[pend.player].ghost;
      this.noteMass(pend, ghost ? { ghost: true } : amount ? { hurt: amount } : { saved: true });
      this.finishResponse(pend);
    });
  }

  finishResponse(response) {
    this.finishResponseDraws(response);
    this.nextPending();
  }

  afterAction() {
    for (const p of this.players) {
      if (p.alive && (!p.ghost || p === this.players[this.turn]) && this.ability(p) === 'Suzy Lafayette' && p.hand.length === 0 && !this.winner) {
        this.give(p, 1);
        this.addLog(`${p.name} hết bài, rút 1 lá (Suzy Lafayette).`);
      }
    }
    if (!this.winner && !this.pending && !this.players[this.turn].alive) this.nextTurn();
  }

  // ---------- hành động của người chơi ----------
  activeSkill(p) {
    const skill = this.ability(p);
    if (skill === 'Chuck Wengam' && p.hp > 1) return skill;
    if (skill === 'Doc Holyday' && this.skillUses < 1 && p.hand.length >= 2) return skill;
    if (skill === 'José Delgado' && this.skillUses < 2 && p.hand.some((card) => this.isBlue(card))) return skill;
    if (skill === 'Black Flower' && this.skillUses === 0 && p.hand.some((c) => c.suit === 'C')) return skill;
    if (skill === 'Der Spot-Burst Ringer' && this.skillUses === 0 && p.hand.some((c) => c.name === 'Bang')) return skill;
    return null;
  }

  useSkill(pi, p, a) {
    const skill = this.activeSkill(p);
    if (!skill) fail('Không thể dùng kỹ năng lúc này.');
    if (skill === 'Chuck Wengam') {
      p.hp--;
      this.give(p, 2);
      this.addLog(`${p.name} trả 1 máu để rút 2 lá.`);
      return;
    }
    const ids = a.cardIds;
    const required = skill === 'Doc Holyday' ? 2 : 1;
    if (!Array.isArray(ids) || ids.length !== required || new Set(ids).size !== ids.length) fail(`Chọn đúng ${required} lá khác nhau.`);
    const cards = ids.map((id) => p.hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) fail('Bạn không có lá bài này.');
    const ti = this.idx(a.target), t = this.players[ti];
    if (skill === 'Doc Holyday' || skill === 'Black Flower') {
      if (!t?.alive || ti === pi || this.distance(pi, ti) > this.range(p)) fail('Chọn người khác trong tầm súng.');
      if (skill === 'Black Flower' && cards[0].suit !== 'C') fail('Chọn một lá chất Chuồn.');
    } else if (skill === 'Der Spot-Burst Ringer') {
      if (cards[0].name !== 'Bang') fail('Chọn một lá Bang!.');
    } else if (!this.isBlue(cards[0])) fail('Chọn một lá viền xanh dương trên tay.');

    this.toDiscard(...ids.map((id) => this.takeFromHand(p, id)));
    for (const card of cards) this.recordPlay(pi, card, 'discard');
    this.skillUses++;
    if (skill === 'Der Spot-Burst Ringer') {
      this.recordSound(PLAY_SOUNDS.Gatling);
      this.addLog(`${p.name} dùng Bang! như Gatling (${skill}).`);
      this.queue = this.alive().filter((i) => i !== pi && !this.ignoredCard(this.players[i], cards[0]))
        .map((i) => ({ ...this.attackPrompt(pi, i, 1), canEscape: true, area: true }));
      return this.nextPending();
    }
    if (skill === 'Black Flower') {
      this.noteTarget(pi, ti, skill);
      this.addLog(`${p.name} dùng lá Chuồn để bắn ${t.name} (${skill}).`);
      return this.startShot(pi, ti, { trueBang: true });
    }
    if (skill === 'Doc Holyday') {
      this.noteTarget(pi, ti, 'Doc Holyday');
      if (cards.every((c) => c.suit === 'D') && this.ignoresDiamonds(t)) {
        this.addLog(`${t.name} miễn đòn của ${p.name} vì cả hai lá đều là Rô.`);
        return;
      }
      this.pending = this.attackPrompt(pi, ti, 1);
      this.recordCombatEffect({ type: 'shot', source: pi, target: ti, projectile: 'bullet' });
      this.addLog(`${p.name} bỏ 2 lá và bắn ${t.name} (${skill}).`);
    } else {
      this.give(p, 2);
      this.addLog(`${p.name} bỏ 1 lá xanh dương và rút 2 lá (${skill}).`);
    }
  }

  // Mọi hành động đi qua đây: làm xong (không lỗi) thì ghi một điểm cán cân
  act(name, a) {
    const credit = this.creditFor(this.idx(name));
    this.doAct(name, a);
    this.recordTimeline(credit);
  }

  doAct(name, a) {
    if (this.winner) fail('Ván đấu đã kết thúc.');
    const pi = this.idx(name);
    if (pi < 0) fail('Bạn không tham gia ván này.');
    const p = this.players[pi];
    if (!p.alive) fail('Bạn đã chết.');

    if (this.phase === 'character') {
      if (a.type !== 'chooseCharacter') fail('Đang chờ chọn nhân vật.');
      this.chooseCharacter(pi, a.character);
      return;
    }

    if (a.type === 'sid') {
      if (this.ability(p) !== 'Sid Ketchum') fail('Chỉ người có kỹ năng Sid Ketchum mới dùng được.');
      if (!this.canHeal(p)) fail('Bạn không thể hồi máu lúc này.');
      const ids = a.cardIds || [];
      if (ids.length !== 2 || ids[0] === ids[1]) fail('Chọn đúng 2 lá.');
      if (!ids.every((id) => p.hand.some((c) => c.id === id))) fail('Bạn không có lá bài này.');
      this.toDiscard(...ids.map((id) => this.takeFromHand(p, id)));
      p.hp++;
      this.addLog(`${p.name} bỏ 2 lá để hồi 1 máu.`);
      return this.afterAction();
    }

    const pend = this.pending;
    if (pend) {
      if (a.type === 'saved' && pend.type !== 'saved') {
        const response = this.savedReaction(pend, pi);
        const card = p.hand.find((c) => c.id === a.cardId && c.name === 'Saved!');
        if (!response || response.player !== this.idx(a.target) || !card || !['hand', 'deck'].includes(a.from)) {
          fail('Chọn Saved! cho người đang bị tấn công.');
        }
        this.takeResponse({ ...response, immediateSave: { player: pi, card, from: a.from } });
        return this.afterAction();
      }
      if (pend.player !== pi) fail('Chưa đến lượt bạn phản hồi.');
      this.respond(pi, p, pend, a);
      return this.afterAction();
    }

    if (this.turn !== pi) fail('Chưa đến lượt của bạn.');
    if (this.phase !== 'play') fail('Không thể làm việc này lúc này.');

    if (a.type === 'skill') {
      this.useSkill(pi, p, a);
    } else if (a.type === 'play' || a.type === 'activate') {
      const played = (a.type === 'activate' ? p.eq : p.hand).find((c) => c.id === a.cardId);
      this.playCard(pi, p, a);
      const recipient = this.recordPlay(pi, played, a.type === 'activate' ? 'discard' : 'play');
      let sound = a.asBang ? null : PLAY_SOUNDS[played.name];
      if (recipient >= 0) {
        const placedBounty = played.name === 'Bounty' && recipient !== pi;
        sound = placedBounty ? EFFECT_SOUNDS.bountyPlaced : EQUIP_SOUNDS[played.name] || 'equipment1';
      }
      if (sound) this.recordSound(randomSound(sound));
    }
    else if (a.type === 'discard') {
      const ids = a.cardIds || [];
      const excess = p.hand.length - this.handLimit(p);
      if (excess <= 0) fail('Bạn không cần bỏ bài.');
      if (!ids.length || ids.length > excess) fail(`Chỉ cần bỏ tối đa ${excess} lá.`);
      if (new Set(ids).size !== ids.length || !ids.every((id) => p.hand.some((c) => c.id === id))) fail('Chọn các lá bài khác nhau đang có trên tay.');
      const cards = ids.map((id) => this.takeFromHand(p, id));
      this.toDiscard(...cards);
      for (const card of cards) this.recordPlay(pi, card, 'discard');
      this.addLog(`${p.name} bỏ ${cards.length} lá.`);
    } else if (a.type === 'endTurn') {
      const excess = p.hand.length - this.handLimit(p);
      if (excess > 0 && !p.ghost) fail(`Bạn phải bỏ bớt ${excess} lá trước khi kết thúc lượt.`);
      this.addLog(`${p.name} kết thúc lượt.`);
      this.nextTurn();
    } else fail('Hành động không hợp lệ.');
    this.afterAction();
  }

  timeout() {
    if (this.winner) return;
    const pend = this.pending;
    const p = this.players[pend ? pend.player : this.turn];
    if (pend?.type === 'blackJack') {
      this.recordTransfer(p, [pend.card], 'reveal', null, true);
      if (!pend.red || !this.give(p, 1)) this.recordSound(EFFECT_SOUNDS.draw, this.idx(p.name));
      this.pending = null;
      this.phase = 'play';
      this.afterAction();
      return this.recordTimeline(this.idx(p.name));
    }
    if (this.phase === 'character') {
      this.addLog(`⏱ ${p.name} hết giờ chọn nhân vật, tự động chọn ngẫu nhiên.`);
      this.chooseCharacter(pend.player, pend.options[Math.floor(this.rng() * pend.options.length)]);
      return;
    }
    this.addLog(`⏱ ${p.name} đã hết thời gian${pend ? ' phản hồi' : ' lượt chơi'}.`);
    if (pend) {
      let action = { type: 'take' };
      if (pend.type === 'check') action = { type: 'checkDraw' };
      if (pend.type === 'draw') action = { type: 'drawChoice', from: 'deck' };
      if (pend.type === 'copyAbility') {
        const choices = this.alive().filter((i) => i !== pend.player);
        action = { type: 'copyAbility', target: this.players[choices[Math.floor(this.rng() * choices.length)]]?.name };
      }
      if (pend.type === 'kit') action = { type: 'kit', cardIds: pend.cards.slice(0, 2).map((c) => c.id) };
      if (pend.type === 'store') action = { type: 'pick', cardId: pend.cards[0].id };
      if (pend.type === 'poker') action = { type: 'poker', cardIds: [] };
      if (pend.type === 'valleyDiscard' && pend.name !== 'Bandidos') {
        action = { type: 'valleyDiscard', cardIds: p.hand.slice(0, pend.count).map((c) => c.id) };
      }
      this.act(p.name, action);
    } else {
      const excess = p.hand.length - this.handLimit(p);
      if (excess > 0 && !p.ghost) this.act(p.name, { type: 'discard', cardIds: p.hand.slice(0, excess).map((c) => c.id) });
      this.act(p.name, { type: 'endTurn' });
    }
  }

  respond(pi, p, pend, a) {
    if (a.type === 'escape') {
      const card = this.escapeCards(p).find((c) => c.id === a.cardId);
      if (!pend.canEscape || !card) fail('Không thể né hiệu ứng này bằng lá đã chọn.');
      this.toDiscard(this.takeFromHand(p, card.id));
      this.recordPlay(pi, card);
      if (card.name === 'Escape') this.recordSound(EFFECT_SOUNDS.escape);
      this.addLog(`${p.name} né hiệu ứng bằng ${card.name}.`);
      this.mollyDraw(p, pend);
      this.noteMass(pend, { card });
      return this.finishResponse(pend);
    }
    switch (pend.type) {
      case 'saved': return this.resolveSaved(pi, p, pend, a);
      case 'lemonade': {
        if (a.type !== 'take') {
          const card = p.hand.find((c) => c.id === a.cardId);
          if (a.type !== 'lemonade' || !card || !this.canHeal(p)) fail('Chọn một lá trên tay để hồi máu.');
          this.toDiscard(this.takeFromHand(p, card.id));
          this.recordPlay(pi, card, 'discard');
          p.hp++;
          this.stats[pi].healed++;
          this.addLog(`${p.name} bỏ một lá để hồi 1 máu (Lemonade Jim).`);
        }
        return this.nextPending();
      }
      case 'avoid': {
        if (a.type !== 'take') fail('Chọn né hoặc chấp nhận hiệu ứng.');
        this.pending = null;
        pend.apply();
        if (!this.pending) this.nextPending();
        return;
      }
      case 'valleyDiscard': {
        if (a.type === 'take' && pend.name === 'Bandidos') {
          return this.resolveDamage(pi, 1, pend.source, pend, () => this.finishResponse(pend));
        }
        const ids = a.cardIds;
        if (pend.name === 'Bandidos' && !pend.count) fail('Bạn phải chịu đòn khi tay không có bài.');
        if (a.type !== 'valleyDiscard' || !Array.isArray(ids) || ids.length !== pend.count ||
            new Set(ids).size !== ids.length || !ids.every((id) => p.hand.some((c) => c.id === id))) {
          fail(`Chọn đúng ${pend.count} lá trên tay.`);
        }
        const cards = ids.map((id) => this.takeFromHand(p, id));
        if (pend.name === 'Poker') pend.collect(cards);
        else {
          this.toDiscard(...cards);
          for (const card of cards) {
            this.recordPlay(pi, card, 'discard');
            if (pend.name === 'Bandidos') this.mollyDraw(p);
          }
        }
        return this.nextPending();
      }
      case 'poker': {
        const ids = a.cardIds;
        if (a.type !== 'poker' || !Array.isArray(ids) || ids.length > 2 || new Set(ids).size !== ids.length ||
            !ids.every((id) => pend.ids.includes(id) && this.discard.some((c) => c.id === id))) fail('Chọn tối đa hai lá đã bỏ.');
        const cards = ids.map((id) => this.discard.splice(this.discard.findIndex((c) => c.id === id), 1)[0]);
        p.hand.push(...cards);
        this.recordTransfer(p, cards, 'discard', null, true);
        if (cards.length) this.recordSound(EFFECT_SOUNDS.draw, pi);
        return this.nextPending();
      }
      case 'copyAbility': {
        const target = this.players[this.idx(a.target)];
        if (a.type !== 'copyAbility' || !target?.alive || target === p) fail('Chọn một nhân vật khác còn sống.');
        p.copiedAbility = target.char;
        this.addLog(`${p.name} sao chép kỹ năng ${target.char}.`);
        this.beginDraw();
        return;
      }
      case 'check': {
        if (a.type !== 'checkDraw') fail('Hãy bấm vào chồng bài để rút kiểm tra.');
        return this.resolveCheck(pi, p, pend);
      }
      case 'draw': {
        if (a.type !== 'drawChoice' || !pend.options.includes(a.from)) fail('Lựa chọn không hợp lệ.');
        if (this.ability(p) === 'Kit Carlson') {
          this.drawStageSeq = (this.drawStageSeq || 0) + 1;
          this.pending = { type: 'kit', player: pi, cards: this.draw(3), stage: this.drawStageSeq };
          return;
        }
        if (a.from === 'evelyn') {
          const targets = Array.isArray(a.targets) ? a.targets.map((name) => this.idx(name)) : [];
          if (!targets.length || targets.length > 2 || new Set(targets).size !== targets.length ||
              targets.some((i) => i === pi || !this.players[i]?.alive || this.distance(pi, i) > this.range(p))) {
            fail('Chọn một hoặc hai mục tiêu khác nhau trong tầm súng.');
          }
          this.give(p, 2 - targets.length);
          this.phase = 'play';
          this.queue = targets.map((i) => ({ run: () => this.startShot(pi, i) }));
          return this.nextPending();
        }
        if (a.from === 'player') {
          const ti = this.idx(a.target);
          const t = this.players[ti];
          if (!t || ti === pi || !t.alive || !t.hand.length) fail('Chọn người có bài trên tay.');
          this.noteTarget(pi, ti, 'Jesse Jones');
          this.pending = null;
          this.phase = 'play';
          return this.beforeRemoval(pi, ti, () => {
            if (this.stealRandom(t, p)) {
              this.give(p, 1);
              this.addLog(`${p.name} lấy 1 lá từ tay ${t.name} và rút 1 lá.`);
            } else this.give(p, 2);
          });
        } else if (a.from === 'discard') {
          const c = this.discard.pop();
          p.hand.push(c);
          this.recordTransfer(p, [c], 'discard');
          if (!this.give(p, 1)) this.recordSound(EFFECT_SOUNDS.draw, pi);
          this.addLog(`${p.name} lấy ${cardStr(c)} từ chồng bài bỏ và rút 1 lá.`);
        } else if (a.from === 'equipment') {
          const ti = this.idx(a.target), target = this.players[ti];
          const index = target?.alive ? target.eq.findIndex((c) => c.id === a.cardId) : -1;
          if (index < 0) fail('Chọn một lá trang bị đang đặt trên bàn.');
          this.noteTarget(pi, ti, 'Pat Brennan');
          const selected = target.eq[index];
          this.pending = null;
          this.phase = 'play';
          return this.beforeRemoval(pi, ti, () => {
            if (!target.eq.includes(selected)) return this.give(p, 2);
            const c = this.removeTargetCard(target, selected);
            p.hand.push(c);
            this.recordTransfer(p, [c], ti, null, true);
            if (pi === ti) this.recordSound(EFFECT_SOUNDS.draw, pi);
            else this.recordSound(randomSound(STEAL_SOUNDS));
            this.addLog(`${p.name} lấy ${cardStr(c)} của ${target.name} (Pat Brennan).`);
          });
        } else {
          this.normalDraw(p);
          if (this.pending?.type === 'blackJack') return;
        }
        this.pending = null;
        this.phase = 'play';
        return;
      }
      case 'kit': {
        const ids = a.cardIds || [];
        if (a.type !== 'kit' || ids.length !== Math.min(2, pend.cards.length) || new Set(ids).size !== ids.length) fail('Chọn 2 lá để giữ.');
        const keep = pend.cards.filter((c) => ids.includes(c.id));
        if (keep.length !== ids.length) fail('Lá không hợp lệ.');
        p.hand.push(...keep);
        this.recordTransfer(p, keep, 'kit', null, false, keep.map((c) => pend.cards.indexOf(c)));
        const returned = pend.cards.filter((c) => !ids.includes(c.id));
        this.deck.push(...returned);
        this.recordTransfer(p, returned, 'kit', 'deck', false, returned.map((c) => pend.cards.indexOf(c)));
        this.addLog(`${p.name} xem 3 lá, giữ 2 và trả lại 1.`);
        this.pending = null;
        this.phase = 'play';
        return;
      }
      case 'store': {
        if (a.type !== 'pick') fail('Hãy chọn 1 lá.');
        const i = pend.cards.findIndex((c) => c.id === a.cardId);
        if (i < 0) fail('Lá không hợp lệ.');
        const c = pend.cards.splice(i, 1)[0];
        p.hand.push(c);
        this.recordSound(EFFECT_SOUNDS.draw, pi);
        this.addLog(`${p.name} chọn ${cardStr(c)} ở General Store.`);
        if (this.store) { this.store.picks.push({ i: pi, card: c }); this.store.t = Date.now(); }
        pend.order.shift();
        while (pend.order.length && !this.players[pend.order[0]].alive) pend.order.shift();
        if (pend.cards.length && pend.order.length) pend.player = pend.order[0];
        else { this.toDiscard(...pend.cards); this.nextPending(); }
        return;
      }
      case 'bang': {
        if (a.type === 'barrel') {
          if (pend.barrels <= 0) fail('Bạn không còn Barrel để dùng.');
          pend.barrels--;
          return this.askCheck(pi, 'Barrel', pend);
        } else if (a.type === 'respond') {
          const c = this.dodgeCards(p).find((x) => x.id === a.cardId);
          if (!c) fail('Lá này không thể dùng để né đòn.');
          const equipped = p.eq.includes(c);
          if (equipped) {
            p.eq.splice(p.eq.indexOf(c), 1);
            this.toDiscard(c);
            this.recordPlay(pi, c, 'discard');
            this.give(p, CARD_INFO[c.name].draw);
          } else {
            this.toDiscard(this.takeFromHand(p, c.id));
            this.recordPlay(pi, c);
            if (c.name === 'Dodge') this.deferResponseDraw(pend, pi, CARD_INFO[c.name].draw);
            this.mollyDraw(p, pend);
          }
          pend.got++;
          this.stats[pi].dodged++;
          const missed = equipped && c.name === 'Iron Plate' ? IRON_PLATE_SOUNDS : MISSED_SOUNDS;
          this.recordSound(c.name === 'Backfire' ? EFFECT_SOUNDS.backfire : randomSound(missed));
          if (pend.got >= pend.need) this.noteAvoid(pi);
          this.addLog(`${p.name} dùng ${c.name === 'Bang' ? 'Bang! (như Missed!)' : c.name === 'Missed' ? 'Missed!' : c.name}.`);
          if (c.name === 'Backfire' && this.players[pend.source].alive) {
            this.queue.unshift({ run: () => this.startShot(pi, pend.source) });
          }
          if (pend.got >= pend.need) this.noteMass(pend, { card: c });
        } else if (a.type === 'take') {
          return this.takeResponse(pend);
        } else fail('Hành động không hợp lệ.');
        if (pend.got >= pend.need) { this.addLog(`${p.name} đã né được!`); this.finishResponse(pend); }
        return;
      }
      case 'indians':
      case 'duel': {
        if (a.type === 'respond') {
          const c = p.hand.find((x) => x.id === a.cardId);
          const ok = c && (c.name === 'Bang' || (c.name === 'Missed' && this.ability(p) === 'Calamity Janet'));
          if (!ok) fail('Cần dùng lá Bang!.');
          this.toDiscard(this.takeFromHand(p, c.id));
          this.recordPlay(pi, c);
          this.mollyDraw(p, pend.type === 'duel' ? pend : null);
          this.addLog(`${p.name} bỏ một Bang!.`);
          this.noteAvoid(pi);
          this.noteMass(pend, { card: c });
          if (pend.type === 'duel') this.pending = { ...pend, player: pend.other, other: pi, canEscape: false };
          else this.nextPending();
        } else if (a.type === 'take') {
          return this.takeResponse(pend);
        } else fail('Hành động không hợp lệ.');
        return;
      }
      default: fail('Không có gì để phản hồi.');
    }
  }

  playCard(pi, p, a) {
    const activate = a.type === 'activate';
    const pile = activate ? p.eq : p.hand;
    const card = pile.find((c) => c.id === a.cardId);
    if (!card) fail('Bạn không có lá bài này.');
    let name = card.name;
    const aim = !activate && name === 'Aim' && !a.asBang;
    let bang = card;
    if (!activate && a.asBang) {
      if (!this.hasLeMat(p)) fail('Bạn cần trang bị LeMat để dùng lá này như Bang!.');
      name = 'Bang';
    } else if (aim) {
      bang = p.hand.find((c) => c.id === a.bangCardId && c !== card);
      if (!bang || (!this.bangCard(p, bang) && !this.hasLeMat(p))) fail('Chọn một lá Bang! dùng kèm Aim.');
      name = 'Bang';
    } else if (this.bangCard(p, card)) name = 'Bang';
    const info = CARD_INFO[name];
    if (activate) {
      if (info.type !== 'green' || !info.activate) fail('Lá này không dùng được trong lượt.');
      if (p.coolingGreen.has(card.id)) fail('Lá này sẽ sẵn sàng ở lượt kế tiếp của bạn.');
    } else if (info.type === 'green') {
      if (this.hasEq(p, card.name)) fail(`Bạn đã có ${card.name}.`);
      p.eq.push(this.takeFromHand(p, card.id));
      p.coolingGreen.add(card.id);
      this.stats[pi].equips++;
      this.addLog(`${p.name} trang bị ${card.name}. Sẵn sàng từ lượt kế tiếp.`);
      return;
    }

    const needTarget = (cond) => {
      const ti = this.idx(a.target);
      const t = this.players[ti];
      if (!t || !t.alive || ti === pi) fail('Hãy chọn một người chơi khác còn sống.');
      if (cond) cond(ti, t);
      return [ti, t];
    };
    const cost = info.discardCost ? p.hand.find((c) => c.id === a.costCardId && c !== card) : null;
    if (info.discardCost && !cost) fail('Hãy chọn thêm một lá khác trên tay để bỏ.');
    const use = () => {
      pile.splice(pile.indexOf(card), 1);
      if (cost) {
        this.toDiscard(this.takeFromHand(p, cost.id));
        this.recordPlay(pi, cost, 'discard');
      }
    };
    const others = () => { const out = []; let j = this.nextAlive(pi); while (j !== pi) { out.push(j); j = this.nextAlive(j); } return out; };

    switch (info.effect || name) {
      case 'Bang':
      case 'attack': {
        const regularBang = name === 'Bang';
        if (regularBang && this.bangsPlayed >= 1 && !this.unlimitedBang(p)) fail('Mỗi lượt chỉ được dùng 1 Bang!.');
        const range = regularBang || info.maxDistance === 'weapon' ? this.range(p) : (info.maxDistance ?? Infinity);
        const [ti, t] = needTarget((ti) => { if (this.distance(pi, ti) > range) fail('Mục tiêu ngoài tầm bắn.'); });
        use(); this.toDiscard(card);
        if (aim) {
          this.toDiscard(this.takeFromHand(p, bang.id));
          this.recordPlay(pi, bang, 'discard');
        }
        this.noteTarget(pi, ti, regularBang ? 'Bang!' : card.name);
        if (regularBang) {
          this.bangsPlayed++;
          this.stats[pi].bangs++;
          this.recordSound(aim ? AIM_SOUNDS.play : randomSound(GUN_SOUNDS[this.gun(p)?.name] || GUN_SOUNDS.default));
        }
        if (info.draw) this.give(p, info.draw);
        if (this.ignoredCard(t, bang)) return;
        this.addLog(`💥 ${p.name} bắn ${t.name}${aim ? ' bằng Aim' : regularBang ? '' : ` bằng ${name}`}!`);
        this.startShot(pi, ti, {
          trueBang: regularBang, aim, amount: aim ? 2 : 1, canEscape: !regularBang && info.type === 'brown',
          projectile: regularBang ? 'bullet' : PROJECTILE_BY_CARD[card.name] ?? 'bullet',
        });
        return;
      }
      case 'Fanning': {
        if (this.bangsPlayed && !this.unlimitedBang(p)) fail('Mỗi lượt chỉ được dùng 1 Bang!.');
        const [ti] = needTarget((i) => { if (this.distance(pi, i) > this.range(p)) fail('Mục tiêu ngoài tầm bắn.'); });
        const choices = this.fanningTargets(pi, ti);
        const second = this.idx(a.secondTarget);
        if (choices.length && !choices.includes(second)) fail('Chọn mục tiêu thứ hai ở khoảng cách 1 từ mục tiêu đầu.');
        use(); this.toDiscard(card);
        this.bangsPlayed++;
        this.stats[pi].bangs++;
        const targets = choices.length ? [ti, second] : [ti];
        this.queue = targets.map((i) => ({ run: () => {
          this.noteTarget(pi, i, name);
          this.startShot(pi, i, { canEscape: true });
        } }));
        return this.nextPending();
      }
      case 'Missed': return fail('Missed! chỉ dùng khi bị bắn.');
      case 'dodge': return fail(`${name} chỉ dùng khi bị bắn.`);
      case 'Beer':
      case 'healOther':
      case 'heal': {
        if (name === 'Beer' && this.alive().length <= 2) fail('Beer vô dụng khi chỉ còn 2 người.');
        const [ti, target] = info.effect === 'healOther' ? needTarget() : [pi, p];
        if (!this.canHeal(target)) fail('Mục tiêu không thể hồi máu lúc này.');
        const heal = Math.min(target.maxHp - target.hp, name === 'Beer' ? this.beerHealing(p) : info.heal);
        use(); this.toDiscard(card);
        if (target !== p && this.ignoredCard(target, card)) return;
        target.hp += heal;
        this.stats[ti].healed += heal;
        this.addLog(name === 'Beer' ? `🍺 ${p.name} uống Beer (+${heal} máu).` : `${p.name} dùng ${name}${target === p ? '' : ` cho ${target.name}`} (+${heal} máu).`);
        if (name === 'Beer') { this.offerLemonade(p); this.nextPending(); }
        return;
      }
      case 'Saloon': {
        use(); this.toDiscard(card);
        for (const i of this.alive()) {
          const q = this.players[i];
          if (this.canHeal(q)) { q.hp++; this.stats[i].healed++; }
        }
        this.addLog(`🥃 ${p.name} mở Saloon: mọi người hồi 1 máu.`);
        return;
      }
      case 'Stagecoach':
      case 'Wells Fargo':
      case 'draw': {
        use(); this.toDiscard(card);
        const n = info.draw ?? (name === 'Stagecoach' ? 2 : 3);
        this.give(p, n);
        this.addLog(`${p.name} dùng ${name}, rút ${n} lá.`);
        return;
      }
      case 'General Store': {
        use(); this.toDiscard(card);
        const order = [pi, ...others()];
        this.pending = { type: 'store', player: pi, order, cards: this.draw(order.length) };
        // Lịch sử chọn (công khai) cho pop-up General Store
        this.storeSeq = (this.storeSeq || 0) + 1;
        this.store = { seq: this.storeSeq, by: pi, card, order: [...order], revealed: [...this.pending.cards], picks: [], t: Date.now(), t0: Date.now() };
        this.addLog(`🏪 ${p.name} mở General Store.`);
        return;
      }
      case 'Panic':
      case 'take':
      case 'discard':
      case 'Cat Balou': {
        const range = name === 'Panic' ? 1 : (info.maxDistance ?? Infinity);
        const [ti, t] = needTarget((ti) => {
          if (this.distance(pi, ti) > range) fail(`${name} chỉ dùng trong khoảng cách ${range}.`);
        });
        const selected = this.targetCard(t, a.targetCard);
        use(); this.toDiscard(card);
        this.noteTarget(pi, ti, name === 'Panic' ? 'Panic!' : card.name);
        if (this.ignoredCard(t, card)) return;
        const remove = () => this.beforeRemoval(pi, ti, () => {
          if (selected ? !t.eq.includes(selected) : !t.hand.length) return;
          const taken = this.removeTargetCard(t, selected);
          const sourceZone = selected ? 'eq' : 'hand';
          if (name === 'Panic' || info.effect === 'take') {
            p.hand.push(taken);
            this.recordTransfer(p, [taken], ti, null, sourceZone === 'eq', null, sourceZone);
            this.recordSound(randomSound(STEAL_SOUNDS));
            this.addLog(`😱 ${p.name} lấy ${selected ? cardStr(taken) : '1 lá trên tay'} của ${t.name}.`);
          } else {
            this.toDiscard(taken);
            this.recordTransfer(t, [taken], ti, 'discard', true, null, sourceZone);
            this.recordSound(TARGET_DISCARD_SOUND);
            this.addLog(`💃 ${p.name} buộc ${t.name} bỏ ${cardStr(taken)}.`);
          }
        });
        if (info.type === 'brown') this.applyBrown(pi, ti, name, remove);
        else remove();
        return;
      }
      case 'discardAll': {
        const targets = others().filter((i) => this.players[i].hand.length || this.players[i].eq.length);
        if (!Array.isArray(a.targets) || a.targets.length !== targets.length || a.targets.some((choice) => !choice || typeof choice.target !== 'string')) {
          fail('Chọn một lá cho mỗi người chơi khác có bài.');
        }
        const selections = new Map(a.targets.map((choice) => [choice.target, choice.targetCard]));
        const removals = targets.map((i) => {
          const target = this.players[i];
          return { i, target, selected: this.targetCard(target, selections.get(target.name)) };
        });
        use(); this.toDiscard(card);
        this.queue = removals.map(({ i, target, selected }) => ({ run: () => {
          if (!p.alive || !target.alive) return;
          this.stats[i].targeted++;
          if (this.ignoredCard(target, card)) return;
          this.applyBrown(pi, i, name, () => this.beforeRemoval(pi, i, () => {
            if (selected ? !target.eq.includes(selected) : !target.hand.length) return;
            const removed = this.removeTargetCard(target, selected);
            this.toDiscard(removed);
            this.addLog(`${p.name} dùng ${name}: ${target.name} bỏ ${cardStr(removed)}.`);
          }));
        } }));
        return this.nextPending();
      }
      case 'Duel': {
        const [ti, t] = needTarget();
        use(); this.toDiscard(card);
        this.noteTarget(pi, ti, 'Duel');
        this.addLog(`🤠 ${p.name} thách đấu ${t.name}!`);
        this.pending = { type: 'duel', player: ti, other: pi, canEscape: true };
        return;
      }
      case 'Bandidos':
      case 'Poker':
      case 'Tornado': {
        use(); this.toDiscard(card);
        const group = name === 'Poker' ? others() : [pi, ...others()];
        const discards = [], discardBy = [], draws = [];
        this.addLog(`${p.name} dùng ${name}.`);
        this.queue = group.map((i) => ({ run: () => {
          if (i !== pi && this.ignoredCard(this.players[i], card)) return;
          const apply = () => {
            const count = Math.min(name === 'Bandidos' ? 2 : 1, this.players[i].hand.length);
            if (name === 'Tornado') draws.push(i);
            if (count || name === 'Bandidos') {
              this.pending = { type: 'valleyDiscard', player: i, source: pi, name, count };
              if (name === 'Poker') this.pending.collect = ([card]) => { discards.push(card); discardBy.push(i); };
            }
          };
          this.applyBrown(pi, i, name, apply);
        } }));
        this.queue.push({ cards: discards, run: () => {
          this.toDiscard(...discards);
          discards.forEach((c, i) => this.recordPlay(discardBy[i], c, 'discard'));
          for (const i of draws) if (this.players[i].alive) this.give(this.players[i], 2);
          if (p.alive && discards.length && !discards.some((c) => c.rank === 'A')) {
            this.pending = { type: 'poker', player: pi, ids: discards.map((c) => c.id) };
          }
        } });
        return this.nextPending();
      }
      case 'Indians':
      case 'attackAll':
      case 'Gatling': {
        use(); this.toDiscard(card);
        if (name === 'Indians' || name === 'Gatling') this.stats[pi].mass++;
        this.addLog(name === 'Indians' ? `🪶 ${p.name} thả thổ dân tấn công!` : `🔫 ${p.name} dùng ${name}!`);
        const targets = others().filter((j) => !this.ignoredCard(this.players[j], card));
        this.massSeq = (this.massSeq || 0) + 1;
        this.mass = { seq: this.massSeq, by: pi, card, targets: targets.map((i) => ({ i, res: null })), t: Date.now(), t0: Date.now() };
        this.queue = targets.map((j) => name === 'Indians'
          ? { type: 'indians', player: j, source: pi, mass: this.massSeq, canEscape: true }
          : { ...this.attackPrompt(pi, j, 1), mass: this.massSeq, canEscape: info.type === 'brown' });
        this.nextPending();
        return;
      }
      case 'Jail': {
        const [ti, t] = needTarget((_, t) => {
          if (t.role === 'Sheriff') fail('Không thể bỏ tù Sheriff.');
          if (this.hasEq(t, 'Jail')) fail('Người này đã ở trong tù.');
        });
        use();
        this.noteTarget(pi, ti, 'Jail');
        if (this.ignoredCard(t, card)) { this.toDiscard(card); return; }
        t.eq.push(card);
        this.jailSeq = (this.jailSeq || 0) + 1;
        t.jailed = this.jailSeq; // hiện song sắt từ lúc bị đặt Jail đến khi rút kiểm tra
        this.addLog(`⛓️ ${p.name} bỏ tù ${t.name}.`);
        return;
      }
      case 'Ghost': {
        const t = this.players[this.idx(a.target)];
        if (!t || t.alive || t.forfeited) fail('Chọn một người đã bị loại và còn ở trong phòng.');
        use();
        t.alive = true;
        t.ghost = true;
        t.hp = 0;
        t.eq.push(card);
        this.addLog(`👻 ${t.name} trở lại dưới dạng Ghost.`);
        return;
      }
      case 'Rattlesnake':
      case 'Bounty': {
        const t = this.players[this.idx(a.target)];
        if (!t?.alive || this.hasEq(t, name)) fail(`Chọn người đang chơi chưa có ${name}.`);
        use();
        if (t !== p && this.ignoredCard(t, card)) this.toDiscard(card);
        else {
          t.eq.push(card);
          this.addLog(`${p.name} đặt ${name} trước ${t.name}.`);
        }
        return;
      }
      default: {
        if (info.type === 'gun') {
          const old = this.gun(p);
          use();
          if (old) { p.eq.splice(p.eq.indexOf(old), 1); this.toDiscard(old); }
          p.eq.push(card);
          this.stats[pi].equips++;
          this.addLog(`${p.name} trang bị ${card.name} (tầm ${info.range}).`);
          return;
        }
        if (info.type === 'blue') {
          if (this.hasEq(p, card.name)) fail(`Bạn đã có ${card.name}.`);
          use(); p.eq.push(card);
          this.stats[pi].equips++;
          this.addLog(`${p.name} trang bị ${card.name}.`);
          return;
        }
        fail('Không thể dùng lá này.');
      }
    }
  }

  // ---------- thống kê & danh hiệu cuối ván ----------
  // lost = số máu thật sự mất (không tính phần âm khi máu đã về 0)
  recordDamage(ti, lost, src) {
    if (lost <= 0) return;
    this.stats[ti].taken += lost;
    if (src == null || src === ti) return;
    this.stats[ti].takenFrom[src] = (this.stats[ti].takenFrom[src] || 0) + lost;
    const st = this.stats[src];
    st.dealt += lost;
    if (st.turnDealtAt !== this.turnNumber) { st.turnDealtAt = this.turnNumber; st.turnDealt = 0; }
    st.turnDealt += lost;
    if (st.turnDealt > st.bestTurn) { st.bestTurn = st.turnDealt; st.bestTurnAt = this.turnNumber; }
    if (sameFaction(this.players[src].role, this.players[ti].role)) {
      st.friendly += lost;
      st.friendlyTo[ti] = (st.friendlyTo[ti] || 0) + lost;
    }
  }

  // Mọi lá/kỹ năng nhắm một người (Bang!, Panic!, Cat Balou, Duel, Jail, Jesse Jones, Pat Brennan, Doc Holyday,
  // lá xanh Dodge City…) đi qua đây: Ai cũng quý bạn, Tướng cướp, Quả tạ vàng, Tao biết mà.
  noteTarget(pi, ti, via) {
    if (pi === ti) return;
    const P = this.players, st = this.stats[pi];
    this.stats[ti].targeted++;
    this.noteSheriffTarget(pi, ti, via);
    if (sameFaction(P[pi].role, P[ti].role)) { st.teamTargets++; st.teamTargetTo[ti] = (st.teamTargetTo[ti] || 0) + 1; }
    if (P[ti].role === 'Renegade') st.renegadeTargets++;
  }

  // Lươn chúa: mỗi lần thoát 1 máu (né xong Bang!/Gatling, đỡ Indians!, bỏ Bang! trong Duel), cộng theo VÒNG
  // (né đòn thường xảy ra trong lượt người khác nên tính cả vòng bàn, không tính theo lượt như Kẻ ủ mưu)
  noteAvoid(pi) {
    const st = this.stats[pi], round = this.roundNumber || 1;
    if (st.roundAvoidedAt !== round) { st.roundAvoidedAt = round; st.roundAvoided = 0; }
    st.roundAvoided++;
    if (st.roundAvoided > st.bestAvoid) { st.bestAvoid = st.roundAvoided; st.bestAvoidAt = round; }
  }

  // Tướng cướp: ghi lại Outlaw nhắm vào Sheriff lần đầu (gọi từ noteTarget).
  noteSheriffTarget(pi, ti, via) {
    if (this.players[pi].role !== 'Outlaw' || this.players[ti].role !== 'Sheriff') return;
    if (this.bandits.some((b) => b.i === pi)) return;
    this.bandits.push({ i: pi, turn: this.turnNumber, via });
  }

  summary() {
    return {
      turns: this.turnNumber || 0,
      minutes: this.startedAt && this.endedAt ? Math.max(1, Math.round((this.endedAt - this.startedAt) / 60000)) : null,
      stats: this.players.map((p, i) => {
        const s = this.stats[i];
        return {
          name: p.name, bangs: s.bangs, dealt: s.dealt, taken: s.taken, kills: s.kills, dodged: s.dodged,
          healed: s.healed, mass: s.mass, equips: s.equips, targeted: s.targeted,
          checks: s.checks, checksOk: s.checksOk, turns: s.ownTurns,
        };
      }),
      awards: this.awards(),
      timeline: this.compactTimeline(),
    };
  }

  // Gửi cho màn kết thúc: trạng thái từng người chỉ giữ ở điểm cuối mỗi lượt (đủ để tính "tác động" của lượt),
  // bỏ các dòng log thủ tục cho nhẹ.
  // Kèm tỉ lệ thắng 3 phe mỗi điểm (w = [Luật pháp, Outlaw, Renegade], power.winProb), máu mọi người (h),
  // và với mỗi lần rút Barrel: tỉ lệ thắng nếu Barrel ra ngược lại (cf = [[người, đỡ được?, law, out, ren]]) để đo hên/xui.
  // Tính một lần khi hết ván rồi giữ lại (viewFor gọi lại nhiều lần).
  compactTimeline() {
    if (!this.timeline?.length) return null;
    const T = this.timeline;
    if (this._tlCompact && this._tlCompact.n === T.length) return this._tlCompact.v;
    const boring = /^(— |.+ rút \d+ lá\.$|.+ kết thúc lượt\.$|.+ đã chọn |Chồng bài đã được xáo)/;
    const roles = this.players.map((p) => p.role), maxHp = this.players.map((p) => p.maxHp);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const arr = (q) => [r3(q.law), r3(q.out), r3(q.ren)];
    const prob = (ps) => power.winProb(ps, this.tlStart, roles, maxHp);
    const fin = { law: +(this.winner === 'Sheriff'), out: +(this.winner === 'Outlaw'), ren: +(this.winner === 'Renegade') };
    const v = {
      start: this.tlStart,
      w0: arr(prob(this.tlStart)),
      pts: T.map((p, k) => {
        const prev = k ? T[k - 1].ps : this.tlStart;
        const cf = [];
        for (const l of p.log) {
          const m = l.match(/^(.+?) rút kiểm tra \(Barrel\): .+ → (thành công|thất bại)/);
          if (!m) continue;
          const i = this.idx(m[1]), ok = m[2] === 'thành công';
          if (i >= 0) cf.push([i, ok ? 1 : 0, ...arr(ok ? prob(power.hurtState(p.ps, i, roles)) : prob(prev))]);
        }
        return {
          t: p.t, r: p.r, o: p.o, a: p.a, b: p.b,
          w: arr(k === T.length - 1 && this.winner ? fin : prob(p.ps)), h: p.ps.map((x) => x[0]),
          ...(cf.length ? { cf } : {}),
          log: p.log.filter((l) => !boring.test(l)),
          ...(k === T.length - 1 || T[k + 1].t !== p.t ? { ps: p.ps } : {}),
        };
      }),
    };
    if (this.winner) this._tlCompact = { n: T.length, v };
    return v;
  }

  // 12 danh hiệu, mỗi cái tối đa 2 hạng (top 1, top 2). Bằng điểm thì chung một hạng.
  awards() {
    const P = this.players, S = this.stats;
    const luck = (i) => (S[i].checks >= MIN_CHECKS ? (S[i].checksOk - S[i].checkExpected) / S[i].checks : null);
    const pct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)}%`;
    const checksSub = (i) => `${S[i].checksOk}/${S[i].checks} lần`;
    const topOf = (map) => Object.entries(map).sort((a, b) => b[1] - a[1])[0];
    const num = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');

    // Ô may rủi: người lệch kỳ vọng xa nhất quyết định ô là Số đỏ (lệch dương) hay Sống chó (lệch âm, hoặc hoà)
    const devs = P.map((_, i) => luck(i)).filter((v) => v != null && v !== 0);
    const best = Math.max(0, ...devs), worst = Math.min(0, ...devs);
    const luckDef = best > -worst
      ? ['lucky', (i) => { const v = luck(i); return v != null && v > 0 ? v : null; }, { fmt: pct, sub: checksSub }]
      : ['unlucky', (i) => { const v = luck(i); return v != null && v < 0 ? -v : null; }, { fmt: (v) => pct(-v), sub: checksSub }];

    // Đớp mạng: xếp theo máu người khác đã cày; bằng nhau thì ai tự gây ít máu hơn xếp trên (cộng phần lẻ rất nhỏ)
    const snatch = (i) => (S[i].snatched > 0 ? S[i].snatched + 1e-3 / (1 + S[i].dealt) : null);
    const snatchSub = (i) => `💀 ${S[i].snatchedFrom.map((k) => P[k].name).join(", ")}`;

    // Thứ tự = vị trí trong lưới 4×3
    const defs = [
      ['damage', (i) => S[i].dealt, { unit: 'máu' }],
      ['killer', (i) => S[i].kills, { unit: 'mạng' }],
      ['schemer', (i) => S[i].bestTurn, { unit: 'máu', sub: (i) => `lượt ${S[i].bestTurnAt}` }],
      ['dodger', (i) => S[i].bestAvoid, { unit: 'máu', sub: (i) => `vòng ${S[i].bestAvoidAt}` }],
      'bandit',
      ['legacy', (i) => (!P[i].alive && S[i].dealt > 0 ? S[i].dealt / Math.max(1, S[i].ownTurns) : null),
        { fmt: (v) => `${num(v)} máu/lượt`, sub: (i) => `${S[i].dealt} máu · ${S[i].ownTurns} lượt` }],
      ['tough', (i) => S[i].lowTurns, { unit: 'lượt' }],
      luckDef,
      ['snatcher', snatch, { fmt: (v) => `đớp ${Math.floor(v)} máu`, sub: snatchSub }],
      ['popular', (i) => S[i].targeted, { unit: 'lần' }],
      ['deadweight', (i) => (P[i].role === 'Renegade' ? null : S[i].teamTargets),
        { unit: 'lần', sub: (i) => { const t = topOf(S[i].teamTargetTo); return t ? `vào ${P[t[0]].name}` : ''; } }],
      // Renegade thắng một mình → "Tao biết mà": người thua nhắm vào Renegade nhiều nhất; còn lại → "Được gánh"
      this.winner === 'Renegade'
        ? ['iknew', (i) => (this.isWinner(P[i]) ? null : S[i].renegadeTargets), { unit: 'lần' }]
        : ['passenger', (i) => (this.isWinner(P[i]) ? S[i].dealt : null), { unit: 'máu', asc: true, allowZero: true }],
    ];
    return defs.map((def) => {
      if (def === 'bandit') {
        return { id: 'bandit', ranks: this.bandits.slice(0, 2).map((b) => ({ players: [P[b.i].name], value: `lượt ${b.turn}`, sub: b.via })) };
      }
      const [id, score, o] = def;
      const cand = P.map((_, i) => ({ i, v: score(i) }))
        .filter(({ v }) => v != null && (o.allowZero || v > 0))
        .sort((a, b) => (o.asc ? a.v - b.v : b.v - a.v));
      const ranks = [];
      for (const c of cand) {
        const last = ranks[ranks.length - 1];
        if (last && Math.abs(last.v - c.v) < 1e-9) last.who.push(c.i);
        else if (ranks.length < 2) ranks.push({ v: c.v, who: [c.i] });
        else break;
      }
      return {
        id,
        ranks: ranks.map(({ v, who }) => ({
          players: who.map((i) => P[i].name),
          value: o.fmt ? o.fmt(v) : `${Math.round(v)} ${o.unit}`,
          sub: o.sub && who.length === 1 ? o.sub(who[0]) : '',
        })),
      };
    });
  }


  // ---------- dữ liệu gửi cho từng người ----------
  viewFor(name) {
    const me = this.idx(name);
    const meAlive = me >= 0 && this.players[me].alive;
    const pend = this.pending;
    let pending = null;
    if (pend) {
      pending = { type: pend.type, player: pend.player };
      if (pend.type === 'character' && pend.player === me) pending.options = [...pend.options];
      if (pend.type === 'bang') Object.assign(pending, { source: pend.source, need: pend.need, got: pend.got, barrels: pend.barrels, amount: pend.amount ?? 1 });
      if (pend.type === 'bang' && pend.player === me) pending.responseCardIds = this.dodgeCards(this.players[me]).map((c) => c.id);
      if (pend.canEscape && pend.player === me) pending.escapeIds = this.escapeCards(this.players[me]).map((c) => c.id);
      if (pend.type === 'saved') Object.assign(pending, { target: pend.target, amount: pend.amount });
      if (['avoid', 'valleyDiscard'].includes(pend.type)) Object.assign(pending, { name: pend.name, count: pend.count });
      if (pend.type === 'poker' && pend.player === me) pending.cards = this.discard.filter((c) => pend.ids.includes(c.id));
      if (meAlive && this.hasSaved(this.players[me])) {
        const reaction = this.savedReaction(pend, me);
        if (reaction) pending.savedReaction = { target: reaction.player };
      }
      if (pend.type === 'indians') pending.source = pend.source;
      if (pend.type === 'duel') pending.other = pend.other;
      if (pend.type === 'store') pending.cards = pend.cards;
      if (pend.type === 'draw') pending.options = pend.options;
      if (pend.type === 'kit') pending.cards = pend.player === me ? pend.cards : pend.cards.map(() => null);
      if (['kit', 'blackJack'].includes(pend.type)) pending.stage = pend.stage;
      if (pend.type === 'blackJack') Object.assign(pending, { card: pend.card, red: pend.red });
      if (pend.type === 'check') {
        pending.kind = pend.kind;
        if (pend.resume) Object.assign(pending, { source: pend.resume.source, need: pend.resume.need, got: pend.resume.got });
      }
      const attack = pend.type === 'check' ? pend.resume : pend;
      if (attack?.type === 'bang' && attack.mass == null && !attack.area) pending.directAttack = true;
    }
    return {
      players: this.players.map((p, i) => ({
        name: p.name, char: p.char, ability: this.ability(p), hp: p.hp, maxHp: p.maxHp, alive: p.alive,
        ghost: !!p.ghost, revivable: !p.alive && !p.forfeited,
        handCount: p.hand.length,
        eq: p.eq.map((c) => {
          const disabled = !this.equipmentActive(p);
          return CARD_INFO[c.name].type === 'green' ? { ...c, ready: !p.coolingGreen.has(c.id), disabled } : disabled ? { ...c, disabled } : c;
        }),
        role: (p.role === 'Sheriff' || !p.alive || p.ghost || i === me || this.winner) ? p.role : null,
        distance: meAlive && p.alive ? this.distance(me, i) : null,
        winner: this.isWinner(p),
        // Jail có thể bị gỡ bằng Panic!/Cat Balou → chỉ hiện khi lá Jail còn trên bàn
        jailed: p.alive && !this.winner && this.hasEq(p, 'Jail') ? (p.jailed || 1) : 0,
      })),
      me: me >= 0 ? {
        index: me, hand: this.players[me].hand, range: this.range(this.players[me]), unlimitedBang: this.unlimitedBang(this.players[me]),
        handLimit: this.handLimit(this.players[me]),
        activeSkill: !this.winner && me === this.turn && !pend && this.phase === 'play' ? this.activeSkill(this.players[me]) : null,
        lemat: me === this.turn && this.hasLeMat(this.players[me]),
        fanningTargets: meAlive && me === this.turn && this.players[me].hand.some((c) => c.name === 'Fanning')
          ? this.alive().filter((i) => i !== me).map((i) => [this.players[i].name, this.fanningTargets(me, i).map((j) => this.players[j].name)]) : [],
      } : null,
      turn: this.turn, phase: this.phase, bangsPlayed: this.bangsPlayed,
      deckCount: this.deck.length, discardTop: this.discard[this.discard.length - 1] || null,
      discardRecent: this.discard.slice(-3), // [cũ nhất, ..., trên cùng]
      pending, log: this.log.slice(-60), winner: this.winner,
      summary: this.winner ? this.summary() : null, // thống kê + danh hiệu, chỉ có khi ván đã xong
      store: this.store ? { ...this.store, order: [...this.store.order], revealed: [...this.store.revealed], picks: this.store.picks.map((x) => ({ ...x })) } : null, // General Store gần nhất cho pop-up
      mass: this.mass ? { ...this.mass, targets: this.mass.targets.map((t) => ({ ...t })) } : null, // lá đánh chung gần nhất + kết quả từng người (công khai) cho pop-up
      lastCheck: this.lastCheck || null, // lá rút kiểm tra gần nhất (đã công khai ở chồng bài bỏ)
      soundSeq: this.soundSeq,
      sounds: this.sounds.filter((cue) => cue.player === null || cue.player === me).map(({ seq, files }) => ({ seq, files })),
      combatEffects: this.combatEffects.slice(),
      plays: (this.plays || []).map((event) => ({ ...event })),
      transfers: (this.transfers || []).map((event) => ({
        seq: event.seq, to: event.to, from: event.from,
        cards: event.cards.map((c) => event.owner === me || event.publicCards || event.from === 'discard' ? c : null),
        slots: event.slots, sourceZone: event.sourceZone,
      })),
    };
  }
}

module.exports = { Game, GameError, CARD_INFO, CHAR_INFO, ROLE_INFO, SUIT_SYMBOL, RULES_PREVIEW, SOUND_FILES,
  greenCardCount: DODGE_CITY.greenCount, dodgeCityCardCount: DODGE_CITY.cards.length, dodgeCityRevision: DODGE_CITY.revision,
  valleyOfShadowCardCount: VALLEY.cards.length, valleyOfShadowRevision: VALLEY.revision };
