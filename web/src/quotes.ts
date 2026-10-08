// Quotes shown on the landing ("What people say"). Hand-picked from the feedback inbox (#/feedback/inbox): only
// feedback whose author ticked "You can quote this", and only the name they gave (never the contact). Empty: the
// section stays hidden.
export interface Quote { text: string, name?: string, role: 'buyer' | 'merchant' | 'looking' }

// TEST samples to preview the section. Delete them before the next push.
export const QUOTES: Quote[] = [
  { text: 'TEST: I sold a camera to a stranger on X and for once I didn\'t have to ship first and pray.', name: 'Ana', role: 'merchant' },
  { text: 'TEST: Paying felt like a normal transfer, but I could see the money was held until the parcel arrived.', name: '@tempobuyer', role: 'buyer' },
  { text: 'TEST: The two-addresses rule is the first escrow pitch I actually understood.', role: 'looking' },
]
