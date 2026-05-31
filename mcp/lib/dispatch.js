const {
  ERROR_CODES,
  classifyDataError,
  classifyException,
  errorEnvelope,
  okEnvelope,
  parseHandlerResult,
} = require("./envelope.js");
const {
  TOOL_HANDLERS,
  getRegisteredTool,
} = require("./tool-registry.js");
const {
  validateToolArguments,
} = require("./tool-validation.js");
const {
  enforceToolPolicy,
} = require("./tool-policy.js");
const {
  safeRecordToolTelemetry,
} = require("./tool-telemetry.js");
const {
  runWithReplaySafety,
} = require("./verification-replay-safety.js");
const {
  readSessionStateStrict,
  sessionStateMissing,
} = require("./session-state-store.js");

function enforceTierPolicy(tool, args) {
  if (tool.min_tier === 0) return;
  const domain = args && args.target_domain;
  if (!domain) return;
  try {
    const { state } = readSessionStateStrict(domain);
    const sessionTier = state.tier_level != null ? state.tier_level : 3;
    if (tool.min_tier > sessionTier) {
      const err = new Error(
        `Tool ${tool.name} requires tier_${tool.min_tier}, session is tier_${sessionTier}`,
      );
      err.code = ERROR_CODES.TIER_BLOCKED;
      err.details = {
        tool: tool.name,
        tool_min_tier: tool.min_tier,
        session_tier_level: sessionTier,
      };
      throw err;
    }
  } catch (error) {
    if (error.code === ERROR_CODES.TIER_BLOCKED) throw error;
    if (sessionStateMissing(error)) return;
    throw error;
  }
}

function shadowSafeErrorMessage(error, authority) {
  const message = error && error.message ? error.message : String(error);
  if (
    authority &&
    authority.authority_shadowed === true &&
    authority.authority_error_code === "no_session" &&
    /Missing session state:/i.test(message)
  ) {
    return "Session state is missing";
  }
  return message;
}

async function executeTool(name, args) {
  const startedAt = Date.now();
  const safeArgs = args || {};
  let authority = null;
  const tool = getRegisteredTool(name);
  const finish = (envelope) => {
    safeRecordToolTelemetry({
      toolName: name,
      tool,
      args: safeArgs,
      envelope,
      elapsedMs: Date.now() - startedAt,
      authority,
    });
    return envelope;
  };

  if (!tool) {
    return finish(errorEnvelope(name, ERROR_CODES.UNKNOWN_TOOL, `Unknown tool: ${name}`));
  }

  try {
    validateToolArguments(name, safeArgs);
    authority = enforceToolPolicy(tool, safeArgs);
    enforceTierPolicy(tool, safeArgs);
  } catch (error) {
    if (error && error.authority) {
      authority = error.authority;
    }
    return finish(errorEnvelope(
      name,
      error.code && Object.values(ERROR_CODES).includes(error.code) ? error.code : ERROR_CODES.INVALID_ARGUMENTS,
      error.message || String(error),
      error.details,
    ));
  }

  try {
    const data = parseHandlerResult(await runWithReplaySafety(tool, safeArgs, () => tool.handler(safeArgs)));
    const dataErrorCode = classifyDataError(data);
    if (dataErrorCode) {
      return finish(errorEnvelope(name, dataErrorCode, data.error, data));
    }
    return finish(okEnvelope(name, data));
  } catch (error) {
    return finish(errorEnvelope(name, classifyException(error), shadowSafeErrorMessage(error, authority), error.details));
  }
}

module.exports = {
  TOOL_HANDLERS,
  executeTool,
};
