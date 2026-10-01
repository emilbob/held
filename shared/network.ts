// Which network this build/server runs on: HELD_NETWORK=testnet (default) or mainnet. One codebase, two deployments.
import testnet from '../network.testnet.json' with { type: 'json' }
import mainnet from '../network.mainnet.json' with { type: 'json' }
import type { Network } from './api.ts'

export const NETWORKS = { testnet: testnet as Network, mainnet: mainnet as Network }
export const pickNetwork = (name?: string): Network => (name === 'mainnet' ? NETWORKS.mainnet : NETWORKS.testnet)
