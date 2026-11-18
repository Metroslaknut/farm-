import { Router } from 'express';
import {
  createExpenseSchema,
  expenseListQuerySchema,
  expenseSummaryQuerySchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse } from '../../lib/http';
import { mountCommonRecordRoutes, recordContext } from '../records/record-routes';
import { createExpense, expenseSpec, listExpenses, summarizeExpenses } from './expenses.service';

/** `/api/v1/farms/:farmId/expenses` — owner/manager only (`expenses.read` / `expenses.write`). */
export function expensesRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.post('/', async (req, res) => {
    res.status(201).json({
      record: await createExpense(
        await recordContext(req, ctx),
        parse(createExpenseSchema, req.body),
      ),
    });
  });
  router.get('/', async (req, res) => {
    const { access } = await recordContext(req, ctx);
    res.json(await listExpenses(access, parse(expenseListQuerySchema, req.query)));
  });
  // Must be declared before /:id
  router.get('/summary', async (req, res) => {
    const { access } = await recordContext(req, ctx);
    res.json({
      summary: await summarizeExpenses(access, parse(expenseSummaryQuerySchema, req.query)),
    });
  });
  mountCommonRecordRoutes(router, ctx, expenseSpec);
  return router;
}
