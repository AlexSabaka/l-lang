import chalk from "chalk";
import { LogLevel } from "../Context";
import { formatWithOptions } from "node:util";
import { getCaller } from "./getCaller";

export function formatLogMessage(level: LogLevel, msg: any, caller?: string) {
    const coloredLogLevel = {
      [LogLevel.Verbose]: chalk.gray,
      [LogLevel.Debug]: chalk.cyan,
      [LogLevel.Info]: chalk.green,
      [LogLevel.Warning]: chalk.yellow,
      [LogLevel.Error]: chalk.red,
    };
  
    const datetime = ""; // chalk.green(new Date().toISOString());
  
    return typeof msg === "string"
      ? `${datetime}${coloredLogLevel[level](
          `${LogLevel[level].padEnd(7)} from ${caller ?? getCaller(4)}`
        )}: ${msg}`
      : `${datetime}${coloredLogLevel[level](
          `${LogLevel[level].padEnd(7)} from ${caller ?? getCaller(4)}`
        )}: ${formatWithOptions({ depth: null, colors: true }, msg)}`;
  }
  