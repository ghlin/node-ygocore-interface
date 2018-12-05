/**
 * card data, from ocgcore/card.h
 */
export interface CardData {
  code: number;
  alias: number;
  type: number;
  level: number;
  attribute: number;
  race: number;
  attack: number;
  defense: number;
  lscale: number;
  rscale: number;
  linkMarker: number;

  /**
   * XXX: setcode field in `cards.cdb` is a 64-bit integer
   *      which is not supported by pure javascript
   *      here it is represented as either
   *        1. a combination of two 32-bit integers, or
   *        2. a string value
   */
  setcode: string | {
    /**
     * high 32-bits of setcode
     */
    high: number;

    /**
     * low 32-bits of setcode
     */
    low: number;
  };
}

/**
 * player info, see ocgcore/ocgapi.h: set_player_info()
 */
export interface PlayerInfo {
  /**
   * player id
   */
  player: number;

  /**
   * startup LP
   */
  lp: number;

  /**
   * initial hand count
   */
  start: number;

  /**
   * draw count (each turn)
   */
  draw: number;
}

/**
 * see ocgcore/ocgapi.h: new_card()
 */
export interface NewCard {
  code: number;
  owner: number;
  player: number;
  location: number;
  sequence: number;
  position: number;
}

export interface ProcessResult {
  /**
   * from `get_message()`
   */
  messages: Buffer;

  /**
   *  high 16 bits of the return value from `process()`
   */
  flags: number;
}

/**
 * what to query, see ocgcore/ocgapi.h: query_field_card()
 */
export interface QueryFieldCardOptions {
  /**
   * player id
   */
  player: number;

  location: number;

  /**
   * QUERY_* flags
   */
  queryFlag: number;

  /**
   * incremental?
   *
   * useCache = 1:
   * 如果上次query时某一项（QUERY_XX)的值未发生改变，这一项
   * 将不会写到返回的buffer中
   */
  useCache: number;
}

export interface QueryCardOptions extends QueryFieldCardOptions {
  /** which card to query */
  sequence: number;
}

/**
 * engine api
 *
 * @param D  the type of duel id/ptr
 */
export interface OCGEngine<D> {
  /**
   * register static card data to engine.
   * @param card card data to register
   */
  registerCard(card: CardData): void;

  /**
   * register a script to engine.
   * @param name filename of the script (just the basename+ext)
   * @param content script content
   */
  registerScript(name: string, content: string): void;

  /**
   * create a duel
   *
   * returns the duel id, pass it to below functions.
   * @param seed random seed
   */
  createDuel(seed: number): number;

  /**
   * create a duel with seed from ygopro's replay
   *
   * returns the duel id, pass it to below functions.
   * @param seed random seed
   */
  createYgoproReplayDuel(seed: number): number;

  /**
   * start a duel
   * @param duel duel id
   * @param options duel options
   */
  startDuel(duel: D, options: number): void;

  /**
   * terminate a duel
   * @param duel duel id
   */
  endDuel(duel: D): void;

  /**
   * set player's initial info, see @see PlayerInfo
   * @param duel duel id
   * @param playerInfo player info to inform the engine
   */
  setPlayerInfo(duel: D, playerInfo: PlayerInfo): void;

  /**
   * add card to a duel, see @see NewCard
   * @param duel duel id
   * @param nc card info
   */
  newCard(duel: D, nc: NewCard): void;

  /**
   * write response to engine
   * @param duel duel id
   * @param response response
   */
  setResponse(duel: D, response: ArrayBuffer): void;

  /**
   * tick
   * @param duel duel id
   */
  process(duel: D): ProcessResult;

  /**
   * query card info
   */
  queryCard(duel: D, qo: QueryCardOptions): Buffer;

  /**
   * query cards specified by {@param qo}
   * @returns length: card count
   *          buffer: card information
   */
  queryFieldCard(duel: D, qo: QueryFieldCardOptions): {
    length: number;
    buffer: Buffer
  };

  /**
   * quer field count
   */
  queryFieldCount(duel: D, player: number, location: number): number;

  /**
   * query field info (MSG_RELOAD_FIELD)
   */
  queryFieldInfo(duel: D): Buffer;
}
