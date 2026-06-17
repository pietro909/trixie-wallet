import { AlertTriangle, KeyRound, RefreshCw } from "lucide-react-native";
import type * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  type SignerMigrationSummary,
  summarizeMigrationReport,
} from "../services/arkade/signer-rotation";
import type { ToastType } from "../services/toast-emitter";
import type { SignerRotationStatus } from "../store/types";
import { useAppStore } from "../store/useAppStore";
import { type AppTheme, radius, spacing, typography } from "../theme/theme";
import Button from "./Button";
import { useToast } from "./ToastProvider";

function formatCutoff(cutoffDateSeconds?: string): string | null {
  if (!cutoffDateSeconds) return null;
  const seconds = Number(cutoffDateSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  try {
    return new Date(seconds * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

function bannerCopy(status: SignerRotationStatus): string {
  switch (status.worstStatus) {
    case "MIGRATABLE": {
      const cutoff = status.reports
        .map((r) => formatCutoff(r.cutoffDateSeconds))
        .find((d): d is string => d != null);
      return cutoff
        ? `Server key rotation pending. Migrate before ${cutoff}.`
        : "Server key rotation pending. Migrate your funds to the updated server key.";
    }
    case "DUE_NOW":
      return "Action required. Migrate wallet funds to the updated server key.";
    case "EXPIRED":
      return "Signer cutoff passed. Some funds are waiting for sweep/recovery.";
    case "UNKNOWN_SIGNER":
      return "Some funds use an unknown server key. Export a support bundle if this persists.";
    default:
      return "";
  }
}

/**
 * Pick the single most important headline + toast severity from a migration
 * summary. Co-occurring conditions are all preserved on the summary; this only
 * chooses what to surface first, in the documented priority order:
 * errors > unilateral-exit > retryable remainder > expired > migrated >
 * unknown-wallet-signer > other skips.
 */
function migrationResultToast(summary: SignerMigrationSummary): {
  message: string;
  type: ToastType;
} {
  if (summary.hasErrors) {
    if (summary.migratedCount > 0) {
      return {
        message: `Migrated ${summary.migratedCount}, but some funds failed — try again.`,
        type: "error",
      };
    }
    return {
      message: `Migration failed: ${summary.errors[0]?.message ?? "unknown error"}`,
      type: "error",
    };
  }
  if (summary.needsUnilateralExit) {
    return {
      message:
        "Some funds exceed cooperative migration limits and need a unilateral exit.",
      type: "error",
    };
  }
  if (summary.hasRetryableRemainder) {
    return {
      message: `Migrated ${summary.migratedCount}; more remain — tap migrate again.`,
      type: "info",
    };
  }
  if (summary.expiredCount > 0) {
    return {
      message:
        summary.migratedCount > 0
          ? `Migrated ${summary.migratedCount}; expired funds will recover after the server sweep.`
          : "Signer cutoff passed; expired funds will recover after the server sweep.",
      type: "info",
    };
  }
  if (summary.migratedCount > 0) {
    return {
      message: `Migrated ${summary.migratedCount} input${
        summary.migratedCount === 1 ? "" : "s"
      } to the updated server key.`,
      type: "success",
    };
  }
  if (summary.globalSkip === "unknown-wallet-signer") {
    return {
      message:
        "Could not migrate: the wallet signer is unknown. Export a support bundle.",
      type: "error",
    };
  }
  const reason = summary.globalSkip ?? summary.legSkips[0]?.reason;
  return {
    message: `Nothing to migrate right now${reason ? ` (${reason})` : ""}.`,
    type: "info",
  };
}

type Severity = SignerRotationStatus["worstStatus"];

function severityColors(
  theme: AppTheme,
  severity: Severity,
): {
  bg: string;
  border: string;
  accent: string;
} {
  // DUE_NOW is the only action-required-now state → danger. EXPIRED and the
  // advisory states use warning so the action-required banner reads as the
  // most urgent.
  if (severity === "DUE_NOW") {
    return {
      bg: theme.colors.dangerSoft,
      border: theme.colors.danger,
      accent: theme.colors.danger,
    };
  }
  return {
    bg: theme.colors.pendingSoft,
    border: theme.colors.warning,
    accent: theme.colors.warning,
  };
}

export default function SignerRotationBanner({
  theme,
}: {
  theme: AppTheme;
}): React.ReactElement | null {
  const status = useAppStore((s) => s.signerRotationStatus);
  const migrationInFlight = useAppStore((s) => s._signerMigrationInFlight);
  const migrate = useAppStore((s) => s.migrateDeprecatedSigners);
  const { showToast } = useToast();

  if (!status) return null;

  const { worstStatus } = status;
  const colors = severityColors(theme, worstStatus);
  const isActionRequired =
    worstStatus === "DUE_NOW" || worstStatus === "EXPIRED";
  const Icon = worstStatus === "DUE_NOW" ? AlertTriangle : KeyRound;

  async function handleMigrate() {
    try {
      const report = await migrate();
      const { message, type } = migrationResultToast(
        summarizeMigrationReport(report),
      );
      showToast(message, type);
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Signer migration failed",
        "error",
      );
    }
  }

  return (
    <View
      accessibilityRole={isActionRequired ? "alert" : undefined}
      accessibilityLiveRegion={isActionRequired ? "assertive" : "polite"}
      style={[
        styles.banner,
        { backgroundColor: colors.bg, borderColor: colors.border },
      ]}
    >
      <View style={styles.row}>
        <Icon color={colors.accent} size={20} />
        <Text style={[styles.message, { color: theme.colors.text }]}>
          {bannerCopy(status)}
        </Text>
      </View>
      {status.hasMigratableFunds ? (
        <Button
          label={migrationInFlight ? "Migrating funds…" : "Migrate funds"}
          variant={worstStatus === "DUE_NOW" ? "danger" : "primary"}
          theme={theme}
          loading={migrationInFlight}
          onPress={handleMigrate}
          icon={
            migrationInFlight ? undefined : (
              <RefreshCw color={theme.colors.onPrimary} size={18} />
            )
          }
          accessibilityLabel="Migrate funds to the updated server key"
          style={styles.button}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: spacing[5],
    padding: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing[3],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
  },
  message: {
    flex: 1,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    lineHeight: 20,
  },
  button: {
    alignSelf: "stretch",
  },
});
