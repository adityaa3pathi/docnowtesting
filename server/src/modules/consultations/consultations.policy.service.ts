/**
 * Consultation rules service. Each edit writes a new immutable version and activates it, so
 * consultations that copied the earlier rules are never affected.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db';
import { logAlert } from '../../utils/logger';
import { DEFAULT_RULES, hasSharpRefundDrop, Rules, validateRules } from './consultations.policy';
import { DoctorError } from './doctors.status';

type Db = PrismaClient;

export async function getActivePolicy(db: Db = prisma) {
    const row = await db.consultPolicy.findFirst({ where: { isActive: true } });
    if (!row) throw new DoctorError(500, 'No active consultation rules');
    return { id: row.id, version: row.version, rules: row.rules as unknown as Rules, reason: row.reason, createdAt: row.createdAt };
}

export async function listPolicyVersions(db: Db = prisma, limit = 20) {
    return db.consultPolicy.findMany({ orderBy: { version: 'desc' }, take: limit });
}

export async function updatePolicy(
    input: { rules: Rules; reason: string; adminId: string; adminName: string; ip: string },
    db: Db = prisma,
) {
    const problem = validateRules(input.rules);
    if (problem) throw new DoctorError(400, problem);

    const result = await db.$transaction(async (tx) => {
        // Lock the active row so two simultaneous edits queue instead of racing on the version number.
        await tx.$queryRaw`SELECT id FROM "ConsultPolicy" WHERE "isActive" = true FOR UPDATE`;
        const current = await tx.consultPolicy.findFirst({ where: { isActive: true } });
        const latest = await tx.consultPolicy.aggregate({ _max: { version: true } });
        if (current) await tx.consultPolicy.update({ where: { id: current.id }, data: { isActive: false } });
        const created = await tx.consultPolicy.create({
            data: {
                version: (latest._max.version ?? 0) + 1,
                isActive: true,
                rules: input.rules as unknown as Prisma.InputJsonValue,
                reason: input.reason,
                createdById: input.adminId,
            },
        });
        const before = (current?.rules as unknown as Rules | undefined) ?? DEFAULT_RULES;
        await tx.adminAuditLog.create({
            data: {
                adminId: input.adminId,
                adminName: input.adminName,
                action: 'CONSULT_POLICY_UPDATE',
                entity: 'ConsultPolicy',
                targetId: created.id,
                oldValue: before as unknown as Prisma.InputJsonValue,
                newValue: { rules: input.rules, reason: input.reason, version: created.version } as unknown as Prisma.InputJsonValue,
                ipAddress: input.ip,
            },
        });
        return { created, before };
    });

    if (hasSharpRefundDrop(result.before, input.rules)) {
        logAlert('consult_policy_refund_drop', { version: result.created.version, adminId: input.adminId });
    }
    return result.created;
}
