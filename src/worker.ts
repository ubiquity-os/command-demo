import { EmailMessage } from "@cloudflare/workers-types";
import { createPlugin } from "@ubiquity-os/plugin-sdk";
import { Manifest } from "@ubiquity-os/plugin-sdk/manifest";
import { LOG_LEVEL, LogLevel } from "@ubiquity-os/ubiquity-os-logger";
import { ExecutionContext } from "hono";
import manifest from "../manifest.json";
import { runPlugin } from "./index";
import { Context, Env, envSchema, PluginSettings, pluginSettingsSchema, SupportedEvents } from "./types";

export default {
  async fetch(request: Request, env: Env, executionCtx?: ExecutionContext) {
    return createPlugin<PluginSettings, Env, null, SupportedEvents>(
      (context) => {
        return runPlugin(context as Context);
      },
      manifest as Manifest,
      {
        envSchema: envSchema,
        postCommentOnError: true,
        settingsSchema: pluginSettingsSchema,
        logLevel: (env.LOG_LEVEL as LogLevel) || LOG_LEVEL.INFO,
        kernelPublicKey: env.KERNEL_PUBLIC_KEY,
        bypassSignatureVerification: process.env.NODE_ENV === "local",
      }
    ).fetch(request, env, executionCtx);
  },

  async email(message: EmailMessage) {
    console.log(JSON.stringify(message));
    console.log("Received email from:", message.from);
    // console.log("Subject:", message.headers.get("subject"));
    console.log("To:", message.to);
  },
};
