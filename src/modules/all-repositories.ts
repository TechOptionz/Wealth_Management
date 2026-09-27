/**
 * Every repository in the application, imported for the side effect of
 * registering its collections.
 *
 * A request only loads the modules its own code imports, so without this list
 * a fresh database would be seeded piecemeal, one screen at a time. The unit of
 * work imports this once before opening its first snapshot so seeding covers
 * everything. Add a line here when you add a module that has a repository.
 */
import '@/modules/access/repository';
import '@/modules/dashboard/repository';
import '@/modules/documents/repository';
import '@/modules/entities/repository';
import '@/modules/expenses/repository';
import '@/modules/leases/repository';
import '@/modules/loans/repository';
import '@/modules/obligations/repository';
import '@/modules/properties/repository';
import '@/modules/reconciliation/repository';
import '@/modules/shared-bills/repository';
