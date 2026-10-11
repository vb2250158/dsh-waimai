/** Validate platform addresses before presenting them or binding a local delivery choice. */
import { createHash } from 'node:crypto'
import { z } from 'zod'

const id = z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive().safe()]).transform(String)
const address = z.object({ id, user_id: id, address: z.string().max(500), address_detail: z.string().max(500),
  name: z.string().max(100), phone: z.string().max(32), city_name: z.string().max(100), tag: z.string().max(100),
  is_valid: z.union([z.literal(0), z.literal(1), z.boolean()]), st_geohash: z.string().nullable(), geohash: z.string().nullable() })

/** Decode the platform's base32 geohash into the centre of its coordinate cell.
 * @param hash - platform location hash.
 * @returns latitude and longitude, or null for an unavailable location.
 */
export function addressCoordinates(hash) {
  if (typeof hash !== 'string' || !/^[0123456789bcdefghjkmnpqrstuvwxyz]{5,12}$/.test(hash)) return null
  const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz'
  const ranges = [[-180, 180], [-90, 90]]
  let axis = 0
  for (const character of hash) {
    const value = alphabet.indexOf(character)
    for (let mask = 16; mask > 0; mask >>= 1) {
      const range = ranges[axis], middle = (range[0] + range[1]) / 2
      range[(value & mask) ? 0 : 1] = middle
      axis = 1 - axis
    }
  }
  return { longitude: (ranges[0][0] + ranges[0][1]) / 2, latitude: (ranges[1][0] + ranges[1][1]) / 2 }
}

/** Reject foreign or duplicate records and produce separate private display and adapter data.
 * @param raw - untrusted HTTP reply.
 * @param accountId - independently verified account.
 * @returns validated addresses; native contact details do not enter model tools.
 */
export function addressRecords(raw, accountId) {
  const records = z.array(address).max(100).parse(raw)
  const seen = new Set()
  return records.map(record => {
    if (record.user_id !== accountId || seen.has(record.id)) throw new Error('address identity mismatch')
    seen.add(record.id)
    const ref = createHash('sha256').update(`taobao:${accountId}:${record.id}`).digest('hex')
    const coordinates = addressCoordinates(record.st_geohash || record.geohash)
    const usable = Boolean(record.is_valid && record.address.trim() && coordinates)
    return { ref, nativeId: record.id, coordinates, geohash: record.st_geohash || record.geohash, display: { ref, label: record.tag || record.city_name,
      address: [record.address, record.address_detail].filter(Boolean).join(' '), contact: record.name,
      maskedPhone: /^1\d{10}$/.test(record.phone) ? `${record.phone.slice(0, 3)}****${record.phone.slice(-4)}` : '', usable } }
  })
}
