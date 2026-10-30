/** Chaque retour arrière est tenté, même si le stockage local est plein. */
export async function preferenceTransaction(apply, rollbackSteps) {
    try { return await apply(); }
    catch (error) {
        const failures = [];
        for (const step of rollbackSteps) {
            try { await step(); } catch (failure) { failures.push(String(failure?.message || failure)); }
        }
        if (failures.length) throw new Error(`${error?.message || error} Récupération incomplète : ${failures.join(' ; ')}. La copie précédente est conservée dans Récupération.`, {cause: error});
        throw error;
    }
}
