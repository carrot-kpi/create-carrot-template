import { BigNumber } from 'ethers'

declare global {
  const __DEV__: boolean
  const CCT_RPC_URL: string
  const CCT_IPFS_GATEWAY_URL: string
  const CCT_IPFS_HTTP_API_URL: string
  const CCT_IPFS_RPC_API_URL: string
  const CCT_CHAIN_ID: number
  const CCT_TEMPLATE_ID: BigNumber
  const CCT_TEMPLATE_ADDRESS: string
  const CCT_DEPLOYMENT_ACCOUNT_PRIVATE_KEY: string
  const CCT_DEPLOYMENT_ACCOUNT_ADDRESS: string
}
