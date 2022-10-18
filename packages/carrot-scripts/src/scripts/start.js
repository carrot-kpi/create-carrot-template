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
import { existsSync } from 'fs'

const PORT = 8545
const MNEMONIC = 'test test test test test test test test test test test junk'
const DERIVATION_PATH = "m/44'/60'/0'/0/0"

const [forkUrl, deploymentScriptLocation] = process.argv.slice(2)
if (!forkUrl) {
  console.error('An RPC URL is needed to fork')
  process.exit(0)
}

const validatedDeploymentScriptLocation = !deploymentScriptLocation
  ? resolve('./packages/contracts/fork/deploy.js')
  : resolve(deploymentScriptLocation)

if (!existsSync(validatedDeploymentScriptLocation)) {
  console.log(
    `No script exists at the ${
      !deploymentScriptLocation ? 'default' : 'specified'
    } location:\n\n  ${chalk.cyan(validatedDeploymentScriptLocation)}`
  )
  console.log()
  console.log(
    'Please pass a custom local fork deployment script location in the following way:'
  )
  console.log()
  console.log(
    `  ${chalk.cyan('carrot-scripts start <FORK_URL>')} ${chalk.green(
      './path/to/deployment-script.js'
    )}`
  )
  process.exit(0)
}

clearConsole()

const main = async () => {
  console.log(
    `Using local fork deployment script location:\n\n  ${chalk.cyan(
      validatedDeploymentScriptLocation
    )}`
  )
  console.log()

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
    process.exit()
  }

  const compileSpinner = ora()
  compileSpinner.start(`Compiling contracts`)
  try {
    execSync('npm run build:contracts')
    compileSpinner.succeed('Contracts compiled')
  } catch (error) {
    compileSpinner.fail('Could not compile contracts')
    process.exit(0)
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
      fork: { url: forkUrl },
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
    process.exit(0)
  }

  const templateDeploymentSpinner = ora()
  templateDeploymentSpinner.start(
    'Deploying and setting up custom template on target network'
  )
  let factory, oraclesManager, multicall, templateContract, customContracts
  try {
    factory = new Contract(chainAddresses.factory, FACTORY_ABI, signer)
    kpiTokensManager = kpiTokensManager.connect(signer)
    oraclesManager = new Contract(
      chainAddresses.oraclesManager,
      ORACLES_MANAGER_ABI,
      signer
    )
    multicall = new Contract(chainAddresses.multicall, MULTICALL_ABI, signer)

    const predictedTemplateId = await kpiTokensManager.templatesAmount()
    const { deploy } = await import(validatedDeploymentScriptLocation)
    const deployData = await deploy(
      factory,
      kpiTokensManager,
      oraclesManager,
      multicall,
      predictedTemplateId.toNumber() + 1,
      signer
    )
    templateContract = deployData.templateContract
    customContracts = deployData.customContracts

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
    process.exit(0)
  }

  clearConsole()

  console.log(chalk.green('Local node successfully set up on target network!'))
  console.log()
  console.log('Used account:')
  console.log()
  console.log('  Address:', signer.address)
  console.log('  Private key:', secretKey)
  console.log()
  console.log('RPC endpoint:')
  console.log()
  console.log('  http://localhost:8545')
  console.log()
  console.log('Contract addresses:')
  console.log()
  console.log('  KPI tokens factory:', factory.address)
  console.log('  KPI tokens manager:', kpiTokensManager.address)
  console.log('  Oracles manager:', oraclesManager.address)
  console.log('  Multicall:', multicall.address)
  console.log('  Template:', templateContract.address)
  customContracts.map(({ name, address }) => {
    console.log(`  ${name}:`, address)
  })
}

main().then().catch(console.error)
