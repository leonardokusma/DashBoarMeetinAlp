import type { Filter } from '../../data/types';
import type { PendingChart } from '../components';

export interface PageContext {
  filter: Filter;
  pending: PendingChart[];
}
