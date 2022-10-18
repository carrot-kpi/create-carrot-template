import chalk from 'chalk'
import envinfo from 'envinfo'
import { ensureLatestVersion } from './ensure-latest-version.js'
import { resolve as pathResolve, basename as pathBasename, join, dirname } from 'path'
import validatePackageName from 'validate-npm-package-name'
import fsExtra from 'fs-extra'
import ora from 'ora'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import copy from 'cpy'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { bold, cyan, green, red } = chalk
const { ensureDirSync, readdirSync, readJSONSync, writeFile, renameSync, removeSync } =
  fsExtra
const { run: envInfoRun } = envinfo

const pkg = fsExtra.readJSONSync(join(__dirname, '../package.json'))

export const createCarrotTemplate = async (projectDirectory, options) => {
  if (options.info) {
    console.log()
    console.log(bold('Environment Info:'))
    console.log()
    console.log(`  Current version of ${pkg.name}: ${pkg.version}`)
    console.log(`  Running from ${__dirname}`)
    console.log(
      await envInfoRun(
        {
          System: ['OS', 'CPU'],
          Binaries: ['Node', 'npm'],
          npmGlobalPackages: ['create-carrot-template'],
        },
        {
          duplicates: true,
          showNotFound: true,
        }
      )
    )
    process.exit(0)
  }

  if (!projectDirectory) {
    console.error('Please specify the template directory:')
    console.log(
      `  ${cyan('create-carrot-template')} [options] ${green('<template-directory>')}`
    )
    console.log()
    console.log('For example:')
    console.log(`  ${cyan('create-carrot-template')} [options] ${green('my-template')}`)
    console.log()
    console.log(`Run ${cyan(`${'create-carrot-template'} --help`)} to see all options.`)
    process.exit(0)
  }

  if (!options.kpiToken && !options.oracle) {
    console.error('Please specify the template type:')
    console.log(
      `  ${cyan('create-carrot-template')} ${green(
        '--kpi-token'
      )} [options] <template-directory>`
    )
    console.log('  or')
    console.log(
      `  ${cyan('create-carrot-template')} ${green(
        '--oracle'
      )} [options] <template-directory>`
    )
    console.log()
    console.log(`Run ${cyan(`${'create-carrot-template'} --help`)} to see all options.`)
    process.exit(0)
  }

  if (options.kpiToken && options.oracle) {
    console.error('Please specify only one template type:')
    console.log(
      `  ${cyan('create-carrot-template')} ${green(
        '--kpi-token'
      )} [options] <template-directory>`
    )
    console.log('  or')
    console.log(
      `  ${cyan('create-carrot-template')} ${green(
        '--oracle'
      )} [options] <template-directory>`
    )
    console.log()
    console.log(`Run ${cyan(`${'create-carrot-template'} --help`)} to see all options.`)
    process.exit(0)
  }

  await ensureLatestVersion(pkg.name, pkg.version)

  const absoluteProjectPath = pathResolve(projectDirectory)
  const projectName = pathBasename(absoluteProjectPath)

  const validationResult = validatePackageName(projectName)
  if (!validationResult.validForNewPackages) {
    console.error(
      red(
        `Cannot create a project named ${green(
          `"${projectName}"`
        )} because of npm naming restrictions:\n`
      )
    )
    ;[...(validationResult.errors || []), ...(validationResult.warnings || [])].forEach(
      (error) => {
        console.error(red(`  * ${error}`))
      }
    )
    console.error(red('\nPlease choose a different project name.'))
    process.exit(0)
  }

  ensureDirSync(absoluteProjectPath) // create project folder if it doesn't exist
  if (readdirSync(absoluteProjectPath).length > 0) {
    console.error(
      red(
        `Cannot create a project in ${green(
          `"${projectDirectory}"`
        )}: the folder is not empty`
      )
    )
    process.exit(0)
  }

  console.log()
  console.log(
    `Creating a new ${
      options.kpiToken ? 'KPI token' : 'oracle'
    } template project in ${green(absoluteProjectPath)}.`
  )
  console.log()

  let spinner = ora()
  spinner.start('Setting up base project\n')
  const projectBasePath = join(__dirname, '../project-base')
  await copy(`${projectBasePath}/**`, absoluteProjectPath, {})
  const projectPkgPath = join(projectBasePath, './package.json')
  const projectPkg = readJSONSync(projectPkgPath)
  projectPkg.name = projectName
  renameSync(
    join(absoluteProjectPath, 'gitignore'),
    join(absoluteProjectPath, '.gitignore')
  )
  await writeFile(
    join(absoluteProjectPath, './package.json'),
    JSON.stringify(projectPkg, undefined, 2)
  )
  ensureDirSync(join(absoluteProjectPath, './packages'))
  spinner.succeed('Base project set up')

  const contractsPreset = options.contractsPreset || 'foundry-solidity'
  const frontendPreset = options.frontendPreset || 'react-typescript'

  process.chdir(absoluteProjectPath)

  spinner = ora()
  try {
    spinner.start(`Setting up smart contracts using preset ${green(contractsPreset)}\n`)
    execSync(
      `git clone https://github.com/carrot-kpi/cct-contracts-${
        options.kpiToken ? 'kpi-token' : 'oracle'
      }-preset-${contractsPreset}.git ./packages/contracts`,
      { stdio: options.verbose ? 'inherit' : 'ignore' }
    )
    removeSync(join(absoluteProjectPath, './packages/contracts/.git'))
    spinner.succeed(`Contracts preset ${green(contractsPreset)} set up`)
  } catch (error) {
    spinner.fail('Aborting installation.')
    console.log()
    console.log(
      red(
        `Unexpected error while setting up frontend template ${contractsPreset}. Please report it as a bug:`
      )
    )
    console.log(error)
    process.exit(0)
  }

  spinner = ora()
  try {
    spinner.start(`Setting up frontend using preset ${green(frontendPreset)}\n`)
    execSync(
      `git clone https://github.com/carrot-kpi/cct-frontend-${
        options.kpiToken ? 'kpi-token' : 'oracle'
      }-preset-${frontendPreset}.git ./packages/frontend`,
      { stdio: options.verbose ? 'inherit' : 'ignore' }
    )
    removeSync(join(absoluteProjectPath, './packages/frontend/.git'))
    spinner.succeed(`Frontend preset ${green(frontendPreset)} set up`)
  } catch (error) {
    spinner.fail('Aborting installation.')
    console.log()
    console.log(
      red(
        `Unexpected error while setting up frontend template ${frontendPreset}. Please report it as a bug:`
      )
    )
    console.log(error)
    process.exit(0)
  }

  spinner = ora()
  try {
    spinner.start('Initializing git repository\n')
    execSync('git init', { stdio: options.verbose ? 'inherit' : 'ignore' })
    if (options.verbose) execSync('git status', { stdio: 'inherit' })
    spinner.succeed('Git repository initialized')
  } catch (error) {
    spinner.fail('Aborting installation.')
    console.log()
    console.log(
      red(
        `Unexpected error while initializing git repository. Please report it as a bug:`
      )
    )
    console.log(error)
    process.exit(0)
  }

  spinner = ora()
  try {
    spinner.start('Installing dependencies')
    execSync(
      'npm install --save-dev @commitlint/cli @commitlint/config-conventional husky carrot-scripts',
      { stdio: options.verbose ? 'inherit' : 'ignore' }
    )
    spinner.succeed('Dependencies installed')
  } catch (error) {
    spinner.fail('Aborting installation.')
    console.log()
    console.log(
      red(`Unexpected error while installing dependencies. Please report it as a bug:`)
    )
    console.log(error)
    process.exit(0)
  }

  spinner = ora()
  try {
    spinner.start('Performing first commit')
    execSync('git add -A', {
      stdio: options.verbose ? 'inherit' : 'ignore',
    })
    execSync('git commit -m "chore: initial create-carrot-template commit"', {
      stdio: options.verbose ? 'inherit' : 'ignore',
    })
    spinner.succeed('First commit performed')
  } catch (error) {
    spinner.fail('Aborting installation.')
    console.log()
    console.log(
      red(`Unexpected error while installing dependencies. Please report it as a bug:`)
    )
    console.log(error)
    process.exit(0)
  }

  console.log()
  console.log(`Success! Created ${green(projectName)} at ${green(absoluteProjectPath)}`)
  console.log('Inside that directory, you can run several commands:')
  console.log()
  console.log(chalk.cyan(`  npm run lint:frontend`))
  console.log("    Lints the frontend's code.")
  console.log()
  console.log(chalk.cyan(`  npm run lint:contracts`))
  console.log('    Lints the contracts code.')
  console.log()
  console.log(chalk.cyan(`  npm run lint:all`))
  console.log('    Lints both contracts and frontend code.')
  console.log()
  console.log(chalk.cyan(`  npm run build:frontend`))
  console.log('    Builds the frontend in a production-ready bundle.')
  console.log()
  console.log(chalk.cyan(`  npm run build:contracts`))
  console.log('    Builds the contracts.')
  console.log()
  console.log(chalk.cyan(`  npm run build:all`))
  console.log('    Builds both the contracts and the frontend code.')
  console.log()
  console.log(chalk.cyan(`  npm run test:frontend`))
  console.log('    Runs the frontend test suite.')
  console.log()
  console.log(chalk.cyan(`  npm run test:contracts`))
  console.log('    Runs the contracts test suite.')
  console.log()
  console.log(chalk.cyan(`  npm run coverage:contracts`))
  console.log('    Runs the contracts test suite collecting coverage data.')
  console.log()
  console.log(chalk.cyan(`  npm run test:all`))
  console.log('    Runs both the contracts and the frontend test suite.')
  console.log()
  console.log(chalk.cyan(`  npm run start:frontend`))
  console.log(
    "    Starts a development server through which to dynamically interact with the template's frontend in the browser."
  )
  console.log()
  console.log('Happy hacking!')
}
