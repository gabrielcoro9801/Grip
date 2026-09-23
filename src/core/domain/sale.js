// Le regole delle sale vivono in `shared/`: il server rifiuta di sospendere una sala ancora
// occupata, le schermate lo dicono prima di provarci, e devono dire la stessa cosa.
export * from '../../../shared/sale.js';
