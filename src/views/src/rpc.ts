import { Electroview } from 'electrobun/view';
import type { PortfolioRPC } from '../../shared/rpc-types.js';

export const rpc = Electroview.defineRPC<PortfolioRPC>({
    maxRequestTime: 120_000,
    handlers: {
        requests: {},
        messages: {}
    }
});
