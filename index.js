#!/usr/bin/env node

const yargs = require("yargs/yargs")
const { hideBin } = require("yargs/helpers")
const chalk = require("chalk")
const fs = require("fs/promises")
const path = require("path")
const yaml = require("yaml")
const selectUserWorkflow = require("./lib/selectUserWorkflow")
const findGitRoot = require("find-git-root")
const prettier = require("prettier")
const { create } = require("domain")
const mkdirp = require("mkdirp")
const getUserWorkflows = require("./lib/getUserWorkflows")
const workflows = require("./lib/workflows")

async function main() {
  const yargsBuilder = yargs(hideBin(process.argv))

  yargsBuilder.command("ls", "List installed workflows")
  yargsBuilder.command("edit", "Edit an existing workflow")
  const installCommand = yargsBuilder.command(
    "install",
    "Install a github workflow",
    (installBuilder) => {
      for (const wfName in workflows) {
        if (!workflows[wfName].description)
          throw new Error(
            `Workflow Template "${wfName}" is missing the "description" export.`
          )
        installBuilder.command(wfName, workflows[wfName].description)
      }
    }
  )

  const argv = yargsBuilder.argv

  const userRepoDir = path.resolve(findGitRoot(process.cwd()), "..")

  if (argv._.length === 0) {
    yargsBuilder.showHelp()
    process.exit(1)
  }

  if (argv._[0] === "ls") {
    const workflows = await getUserWorkflows({ userRepoDir })
    for (const wf of workflows) {
      console.log(`${wf.fileName} ${chalk.grey(wf.gwmConfig.type)}`)
    }
    process.exit(0)
  }

  let workflowType
  if (argv._[0] === "install") {
    workflowType = argv._[1]
    if (!workflows[workflowType]) {
      yargsBuilder.showHelp()
      process.exit(1)
    }
  }

  const workflowsDir = path.join(userRepoDir, ".github", "workflows")
  if (!(await fs.stat(workflowsDir).catch((e) => null))) {
    console.log(`Creating directory "${workflowsDir}"`)
    await mkdirp(workflowsDir)
  }

  const { selectedWorkflowName, gwmConfig } = await selectUserWorkflow({
    userRepoDir,
    workflowType,
    workflowDef: workflows[workflowType],
  })
  workflowType = gwmConfig.type

  const createdWorkflow = await workflows[
    workflowType
  ].createWorkflowInteractive({ ...argv, userRepoDir, config: gwmConfig })

  const outputPath = path.resolve(
    userRepoDir,
    ".github",
    "workflows",
    `${selectedWorkflowName}.yml`
  )
  console.log(`Writing to "${outputPath.replace(userRepoDir + "/", "")}"`)

  let fileContent =
    typeof createdWorkflow.content === "string"
      ? createdWorkflow.content
      : yaml.stringify(createdWorkflow.content)
  const configFile = await prettier.resolveConfig(outputPath)
  fileContent = prettier.format(fileContent, { ...configFile, parser: "yaml" })

  await fs.writeFile(
    outputPath,
    `# GENERATED BY github-workflow-manager\n# gwm: ${JSON.stringify({
      type: workflowType,
      ...createdWorkflow.config,
    })}\n${fileContent}`
  )

  console.log(
    `\n${chalk.green(
      "Success!"
    )}\n\n=====================================================\n\n${workflowType} usage:\n\n${
      workflows[workflowType].usage
    }\n\n`
  )
}

if (!module.parent) {
  main().catch((e) => {
    const quietErrors = ["Cancelled by user"]
    const err = e.toString()
    console.log(
      chalk.red(
        err +
          (quietErrors.some((qErr) => err.includes(qErr))
            ? ""
            : "\n\n" + e.stack)
      ) + "\n"
    )
  })
}
