/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { ConfigurationError, CloudApiError } from "../../../exceptions"
import { ListUsersResponse } from "@garden-io/platform-api-types"

import { printHeader } from "../../../logger/util"
import { dedent, deline, renderTable } from "../../../util/string"
import { Command, CommandParams, CommandResult } from "../../base"
import { applyFilter, makeUserFromResponse, noApiMsg, UserResult } from "../helpers"
import chalk from "chalk"
import { sortBy } from "lodash"
import { StringsParameter } from "../../../cli/params"
import { getCloudDistributionName } from "../../../util/util"
import { CloudProject } from "../../../cloud/api"

export const usersListOpts = {
  "filter-names": new StringsParameter({
    help: deline`Filter on user name. You may filter on multiple names by setting this flag multiple times. Accepts glob patterns.`,
  }),
  "filter-groups": new StringsParameter({
    help: deline`Filter on the groups the user belongs to. You may filter on multiple groups by setting this flag multiple times. Accepts glob patterns.`,
  }),
}

type Opts = typeof usersListOpts

export class UsersListCommand extends Command<{}, Opts> {
  name = "list"
  help = "List users defined in Garden Cloud."
  override description = dedent`
    List all users from Garden Cloud. Optionally filter on group names or user names.

    Examples:
        garden cloud users list                            # list all users
        garden cloud users list --filter-names Gordon*     # list all the Gordons in Garden Cloud. Useful if you have a lot of Gordons.
        garden cloud users list --filter-groups devs-*     # list all users in groups that with names that start with 'dev-'
  `

  override options = usersListOpts

  override printHeader({ log }) {
    printHeader(log, "List users", "💁‍♀️")
  }

  async action({ garden, log, opts }: CommandParams<{}, Opts>): Promise<CommandResult<UserResult[]>> {
    const nameFilter = opts["filter-names"] || []
    const groupFilter = opts["filter-groups"] || []

    const api = garden.cloudApi
    if (!api) {
      throw new ConfigurationError({ message: noApiMsg("list", "users"), detail: {} })
    }

    let project: CloudProject | undefined

    if (garden.projectId) {
      project = await api.getProjectById(garden.projectId)
    }

    if (!project) {
      throw new CloudApiError({
        message: `Project ${garden.projectName} is not a ${getCloudDistributionName(api.domain)} project`,
        detail: {},
      })
    }

    // Make a best effort VCS provider guess. We should have an API endpoint for this or return with the response.
    const vcsProviderTitle = project.repositoryUrl.includes("github.com")
      ? "GitHub"
      : project.repositoryUrl.includes("gitlab.com")
      ? "GitLab"
      : "VCS"

    let page = 0
    let users: UserResult[] = []
    let hasMore = true
    while (hasMore) {
      log.debug(`Fetching page ${page}`)
      const res = await api.get<ListUsersResponse>(`/users?page=${page}`)
      if (res.data.length === 0) {
        hasMore = false
      } else {
        users.push(...res.data.map((user) => makeUserFromResponse(user)))
        page++
      }
    }

    log.info("")

    if (users.length === 0) {
      log.info("No users found in project.")
      return { result: [] }
    }

    const filtered = sortBy(users, "name")
      .filter((user) => applyFilter(nameFilter, user.name))
      .filter((user) =>
        applyFilter(
          groupFilter,
          user.groups.map((g) => g.name)
        )
      )

    if (filtered.length === 0) {
      log.info("No users found in project that match filters.")
      return { result: [] }
    }

    log.debug(`Found ${filtered.length} users that match filters`)

    const heading = ["Name", "ID", `${vcsProviderTitle} Username`, "Groups", "Created At"].map((s) => chalk.bold(s))
    const rows: string[][] = filtered.map((u) => {
      return [
        chalk.cyan.bold(u.name),
        String(u.id),
        u.vcsUsername || "",
        u.groups.map((g) => g.name).join(", "),
        new Date(u.createdAt).toUTCString(),
      ]
    })

    log.info(renderTable([heading].concat(rows)))

    return { result: filtered }
  }
}
