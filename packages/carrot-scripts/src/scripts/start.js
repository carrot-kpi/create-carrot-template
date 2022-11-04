#!/usr/bin/env node

import { execSync } from 'child_process'
import { Wallet, providers, Contract } from 'ethers'
import {
  ChainId,
  CHAIN_ADDRESSES,
  FACTORY_ABI,
  KPI_TOKENS_MANAGER_ABI,
  ORACLES_MANAGER_ABI,
  MULTICALL_ABI,
} from '@carrot-kpi/sdk'
import ora from 'ora'
import chalk from 'chalk'
import ganache from 'ganache'
import { Daemon } from 'ipfs-daemon'
import { clearConsole } from '../utils/index.js'
import { join, resolve } from 'path'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { Writable } from 'stream'

const GANACHE_PORT = 9001
const IPFS_GATEWAY_API_PORT = 9090
const IPFS_HTTP_API_PORT = 5002
const IPFS_RPC_API_PORT = 5003
const MNEMONIC = 'test test test test test test test test test test test junk'
const DERIVATION_PATH = "m/44'/60'/0'/0/0"
const IPFS_REPO_PATH = join(homedir(), '.cct/ipfs')

const printInformation = (
  deploymentAccountAddress,
  deploymentAccountSecretKey,
  factoryAddress,
  kpiTokensManagerAddress,
  oraclesManagerAddress,
  multicallAddress,
  templateContractAddress,
  customContracts
) => {
  console.log(chalk.green('Local playground successfully started up on target network!'))
  console.log()
  console.log(chalk.cyan('Used chain-setup account:'))
  console.log()
  console.log('  Address:', deploymentAccountAddress)
  console.log('  Private key:', deploymentAccountSecretKey)
  console.log()
  console.log(chalk.cyan('RPC endpoints:'))
  console.log()
  console.log(`  http://localhost:${GANACHE_PORT}`)
  console.log(`  ws://localhost:${GANACHE_PORT}`)
  console.log()
  console.log(chalk.cyan('IPFS endpoints:'))
  console.log()
  console.log(`  - Gateway: http://localhost:${IPFS_GATEWAY_API_PORT}`)
  console.log(`  - HTTP API: http://localhost:${IPFS_HTTP_API_PORT}`)
  console.log(`  - RPC API: http://localhost:${IPFS_RPC_API_PORT}`)
  console.log()
  console.log(chalk.cyan('Contract addresses:'))
  console.log()
  console.log('  KPI tokens factory:', factoryAddress)
  console.log('  KPI tokens manager:', kpiTokensManagerAddress)
  console.log('  Oracles manager:', oraclesManagerAddress)
  console.log('  Multicall:', multicallAddress)
  console.log('  Template:', templateContractAddress)
  if (customContracts)
    customContracts.map(({ name, address }) => {
      console.log(`  ${name}:`, address)
    })
  console.log()
  console.log(chalk.cyan('Frontend log:'))
}

const [forkUrl] = process.argv.slice(2)
if (!forkUrl) {
  console.error('Please specify an RPC endpoint to fork from.')
  console.error('If invoking directly:')
  console.log(`  ${chalk.cyan('carrot-scripts')} start ${chalk.green('<rpc-endpoint>')}`)
  console.log('  or if invoking from a Carrot Create Template project:')
  console.log(`  ${chalk.cyan('npm start')} -- ${chalk.green('<rpc_endpoint>')}`)
  process.exit(0)
}

const setupForkScriptLocation = resolve('./packages/contracts/.cct/setup-fork.js')
const specificationLocation = resolve('./packages/frontend/src/base.json')
const startPlaygroundScriptLocation = resolve(
  './packages/frontend/.cct/start-playground.js'
)

clearConsole()

const forkCheckSpinner = ora()
forkCheckSpinner.start(`Checking forked network chain id`)
let forkedNetworkChainId, forkNetworkProvider
try {
  forkNetworkProvider = new providers.JsonRpcProvider(forkUrl)
  const network = await forkNetworkProvider.getNetwork()
  forkedNetworkChainId = network.chainId
  if (!(forkedNetworkChainId in ChainId)) {
    forkCheckSpinner.fail(`Incompatible forked chain id ${forkedNetworkChainId}`)
    console.log()
    console.log(
      'Compatible chain ids are:',
      Object.values(ChainId)
        .filter((chainId) => !isNaN(chainId))
        .join(', ')
    )

    process.exit(0)
  }
  forkCheckSpinner.succeed(`Compatible forked chain id ${forkedNetworkChainId}`)
} catch (error) {
  forkCheckSpinner.fail(
    `Error determining the forked chain id. Maybe your fork URL is malformed?`
  )
  console.log()
  console.log(error)
  process.exit(1)
}

const compileSpinner = ora()
compileSpinner.start(`Compiling contracts`)
try {
  execSync('npm run build:contracts')
  compileSpinner.succeed('Contracts compiled')
} catch (error) {
  compileSpinner.fail('Could not compile contracts')
  console.log()
  console.log(error)
  process.exit(1)
}

const ganacheSpinner = ora()
ganacheSpinner.start(
  `Starting up local node with fork URL ${forkUrl} and chain id ${forkedNetworkChainId}`
)
const chainAddresses = CHAIN_ADDRESSES[forkedNetworkChainId]
let ganacheProvider, kpiTokensManager, kpiTokensManagerOwner, signer, secretKey
try {
  kpiTokensManager = new Contract(
    chainAddresses.kpiTokensManager,
    KPI_TOKENS_MANAGER_ABI,
    forkNetworkProvider
  )
  kpiTokensManagerOwner = await kpiTokensManager.owner()
  const ganacheServer = ganache.server({
    fork: { url: forkUrl, deleteCache: true, disableCache: true },
    chain: {
      chainId: forkedNetworkChainId,
    },
    wallet: {
      mnemonic: MNEMONIC,
      hdPath: DERIVATION_PATH,
      unlockedAccounts: [kpiTokensManagerOwner],
    },
    logging: {
      quiet: true,
    },
  })
  await new Promise((resolve, reject) => {
    ganacheServer.once('open').then(() => {
      resolve()
    })
    ganacheServer.listen(GANACHE_PORT).catch(reject)
  })

  const accounts = await ganacheServer.provider.getInitialAccounts()
  const account = Object.values(accounts)[0]
  secretKey = account.secretKey
  ganacheProvider = new providers.JsonRpcProvider(`http://localhost:${GANACHE_PORT}`)
  signer = new Wallet(secretKey, ganacheProvider)
  ganacheSpinner.succeed(`Started up local node with fork URL ${forkUrl}`)
} catch (error) {
  ganacheSpinner.fail(
    `Could not start up node with fork URL ${forkUrl} and chain id ${forkedNetworkChainId}`
  )
  console.log()
  console.log(error)
  process.exit(1)
}

const ipfsNodeSpinner = ora()
ipfsNodeSpinner.start('Starting up local IPFS node')
let ipfs, specificationCid
try {
  const daemon = new Daemon({
    silent: true,
    repo: IPFS_REPO_PATH,
    start: false,
    config: {
      API: {
        HTTPHeaders: {
          'Access-Control-Allow-Origin': [
            'http://127.0.0.1:9000',
            'http://127.0.0.1:9000/',
            'http://localhost:9000',
            'http://localhost:9000/',
          ],
        },
      },
    },
  })
  await daemon.start()
  ipfs = daemon._ipfs

  const cleanup = async () => {
    console.log()
    const cleanupSpinner = ora()
    cleanupSpinner.start('Received interrupt signal, gracefully shutting down')
    await daemon.stop()
    cleanupSpinner.succeed('Gracefully shut down')
    process.exit(0)
  }

  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGHUP', cleanup)

  await ipfs.start()
  const result = await ipfs.add(readFileSync(specificationLocation).toString())
  specificationCid = result.cid.toString()
  ipfsNodeSpinner.succeed('Started up local IPFS node')
} catch (error) {
  ipfsNodeSpinner.fail('Could not start up local IPFS node')
  console.log()
  console.log(error)
  process.exit(1)
}

const templateDeploymentSpinner = ora()
templateDeploymentSpinner.start(
  'Deploying and setting up custom template on target network'
)
let factory,
  oraclesManager,
  multicall,
  templateContract,
  customContracts,
  frontendGlobals,
  predictedTemplateId
try {
  factory = new Contract(chainAddresses.factory, FACTORY_ABI, signer)
  kpiTokensManager = kpiTokensManager.connect(signer)
  oraclesManager = new Contract(
    chainAddresses.oraclesManager,
    ORACLES_MANAGER_ABI,
    signer
  )
  multicall = new Contract(chainAddresses.multicall, MULTICALL_ABI, signer)

  predictedTemplateId = (await kpiTokensManager.templatesAmount()).add('1').toNumber()
  const { setupFork } = await import(setupForkScriptLocation)
  const setupResult = await setupFork(
    factory,
    kpiTokensManager,
    oraclesManager,
    multicall,
    predictedTemplateId,
    signer
  )
  templateContract = setupResult.templateContract
  customContracts = setupResult.customContracts
  frontendGlobals = setupResult.frontendGlobals

  await kpiTokensManager
    .connect(ganacheProvider.getSigner(kpiTokensManagerOwner))
    .addTemplate(templateContract.address, specificationCid, {
      from: kpiTokensManagerOwner,
    })
  templateDeploymentSpinner.succeed(
    'Custom template deployed and set up on target network'
  )
} catch (error) {
  templateDeploymentSpinner.fail(
    'Could not deploy and set up custom template on target network'
  )
  console.log()
  console.log(error)
  process.exit(1)
}

const frontendSpinner = ora()
frontendSpinner.start('Starting up local playground')
try {
  const { startPlayground } = await import(startPlaygroundScriptLocation)
  await startPlayground(
    forkedNetworkChainId,
    predictedTemplateId,
    secretKey,
    Object.entries(frontendGlobals).reduce(
      (accumulator, [key, rawValue]) => {
        accumulator[key] = JSON.stringify(rawValue)
        return accumulator
      },
      {
        __DEV__: JSON.stringify(true),
        CCT_RPC_URL: JSON.stringify(ganacheProvider.connection.url),
        CCT_IPFS_GATEWAY_URL: JSON.stringify(
          `http://localhost:${IPFS_GATEWAY_API_PORT}/ipfs`
        ),
        CCT_IPFS_HTTP_API_URL: JSON.stringify(`http://localhost:${IPFS_HTTP_API_PORT}/`),
        CCT_IPFS_RPC_API_URL: JSON.stringify(`http://localhost:${IPFS_RPC_API_PORT}/`),
        CCT_CHAIN_ID: JSON.stringify(forkedNetworkChainId),
        CCT_TEMPLATE_ID: JSON.stringify(predictedTemplateId),
        CCT_DEPLOYMENT_ACCOUNT_PRIVATE_KEY: JSON.stringify(secretKey),
      }
    ),
    new Writable({
      write(chunk, _, callback) {
        clearConsole()
        printInformation(
          signer.address,
          secretKey,
          factory.address,
          kpiTokensManager.address,
          oraclesManager.address,
          multicall.address,
          templateContract.address,
          customContracts
        )
        console.log()
        console.log(chunk.toString().replace(/^/gm, `  `))
        callback()
      },
    })
  )
  frontendSpinner.stop()
} catch (error) {
  frontendSpinner.fail('Could not start up local playground')
  console.log()
  console.log(error)
  process.exit(1)
}
