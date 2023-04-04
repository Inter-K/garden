/*
 * Copyright (C) 2018-2023 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import Bluebird from "bluebird"
import moment from "moment"
import { lstat, pathExists, remove } from "fs-extra"
import { join } from "path"
import { LogEntry } from "../logger/log-entry"
import { listDirectory } from "../util/fs"

const logfileExpiryDays = 7

/**
 * Deletes any debug/JSON logfiles that are older than `logfileExpiryDays`, and returns the debug & silly
 * logfile names for the currently executing command.
 */
export async function prepareDebugLogfiles(log: LogEntry, logsDirPath: string, commandFullName: string) {
  try {
    if (await pathExists(logsDirPath)) {
      const filenames = await listDirectory(logsDirPath, { recursive: false })
      // We don't want to slow down init, so we don't await this promise.
      Bluebird.map(filenames, async (filename) => {
        if (!filename.match(/debug.*\.log/) && !filename.match(/json.*\.log/)) {
          return
        }
        const logfilePath = join(logsDirPath, filename)
        const stat = await lstat(logfilePath)
        // If the file is older than `logExpiryDays` days, delete it
        if (moment(stat.birthtime).add(logfileExpiryDays, "days").isBefore(moment())) {
          log.debug(`file ${filename} is older than ${logfileExpiryDays} days, deleting...`)
          await remove(logfilePath)
        }
      }).catch((err) => {
        log.warn(`An error occurred while cleaning up debug logfiles: ${err.message}`)
      })
    }
  } catch (err) {
    // We don't want control flow to stop if there's an error during logfile cleanup.
    log.warn(`An error occurred while cleaning up debug logfiles: ${err.message}`)
  }

  return {
    debugLogfileName: makeLogfileName("debug", commandFullName, "log"),
    jsonLogfileName: makeLogfileName("silly", commandFullName, "jsonl"),
  }
}

// Example: build.debug.2022-01-31T09:33:55.001Z.log
function makeLogfileName(logLevel: string, commandFullName: string, extension: string): string {
  return `${commandFullName.replace(" ", "-")}.${logLevel}.${new Date().toISOString()}.${extension}`
}
