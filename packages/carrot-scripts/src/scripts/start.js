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
import { clearConsole } from '../utils/index.js'
import { resolve } from 'path'
import { Writable } from 'stream'

const PORT = 8545
const MNEMONIC = 'test test test test test test test test test test test junk'
const DERIVATION_PATH = "m/44'/60'/0'/0/0"

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
  console.log('Used account:')
  console.log()
  console.log('  Address:', deploymentAccountAddress)
  console.log('  Private key:', deploymentAccountSecretKey)
  console.log()
  console.log('RPC endpoint:')
  console.log()
  console.log('  http://localhost:8545')
  console.log()
  console.log('Contract addresses:')
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

const deployToForkScriptLocation = resolve('./packages/contracts/.cct/deploy-to-fork.js')
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
    ganacheServer.listen(PORT).catch(reject)
  })

  const accounts = await ganacheServer.provider.getInitialAccounts()
  const account = Object.values(accounts)[0]
  secretKey = account.secretKey
  ganacheProvider = new providers.JsonRpcProvider(`http://localhost:${PORT}`)
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

const templateDeploymentSpinner = ora()
templateDeploymentSpinner.start(
  'Deploying and setting up custom template on target network'
)
let factory,
  oraclesManager,
  multicall,
  templateContract,
  customContracts,
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

  predictedTemplateId = await kpiTokensManager.templatesAmount()
  const { deployToFork } = await import(deployToForkScriptLocation)
  const deploymentData = await deployToFork(
    factory,
    kpiTokensManager,
    oraclesManager,
    multicall,
    predictedTemplateId.toNumber() + 1,
    signer
  )
  templateContract = deploymentData.templateContract
  customContracts = deploymentData.customContracts

  await kpiTokensManager
    .connect(ganacheProvider.getSigner(kpiTokensManagerOwner))
    .addTemplate(templateContract.address, 'specification', {
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
        console.log(chunk.toString())
        callback()
      },
    })
  )
  frontendSpinner.succeed('Local playground started up')
} catch (error) {
  frontendSpinner.fail('Could not start up local playground')
  console.log()
  console.log(error)
  process.exit(1)
}
