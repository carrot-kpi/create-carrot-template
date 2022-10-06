import { get } from 'https'
import chalk from 'chalk'
import semver from 'semver'

const { cyan, yellow } = chalk

const logErrorAndExit = (name) => {
  console.error(
    `Could not determine if you're running the latest version of \`${name}\`. Please try again in a few minutes.`
  )
  console.log()
  console.log(`    If the problem persists, file an issue:`)
  console.log(
    `      ${cyan('https://github.com/carrot-kpi/create-carrot-template/issues/new')}`
  )
  process.exit(0)
}

export const ensureLatestVersion = async (name, version) => {
  try {
    const response = await new Promise((resolve, reject) => {
      get(`https://registry.npmjs.org/-/package/${name}/dist-tags`, (response) => {
        if (
          !response.statusCode ||
          response.statusCode < 200 ||
          response.statusCode > 299
        ) {
          reject()
        }
        const body = []
        response.on('data', (chunk) => body.push(chunk))
        response.on('end', () => resolve(JSON.parse(body.join(''))))
      })
    })
    const { latest } = response
    if (!latest) logErrorAndExit()
    if (latest && semver.lt(version, latest)) {
      console.log()
      console.error(
        yellow(
          `You are running \`create-carrot-template\` ${version}, which is behind the latest release (${latest}).\n\n` +
            'We recommend always using the latest version of `create-carrot-template` if possible.'
        )
      )
      console.log()
      process.exit(0)
    }
  } catch (error) {
    logErrorAndExit()
  }
}
