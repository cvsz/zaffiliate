const RESOURCE_GROUPS = {
  affiliateCreator: {
    label: 'Affiliate Creator',
    methods: {
      listCampaigns: { path: '/affiliate_creator/campaign/search', method: 'GET' },
      listOrders: { path: '/affiliate_creator/order/search', method: 'GET' },
      respondToInvitation: { path: '/affiliate_creator/invitation/respond', method: 'POST', mutating: true }
    }
  },
  affiliatePartner: {
    label: 'Affiliate Partner',
    methods: {
      listCampaigns: { path: '/affiliate_partner/campaign/search', method: 'GET' },
      listOrders: { path: '/affiliate_partner/order/search', method: 'GET' }
    }
  },
  affiliateSeller: {
    label: 'Affiliate Seller',
    methods: {
      createCampaign: { path: '/affiliate_seller/campaign/create', method: 'POST', mutating: true },
      listCampaigns: { path: '/affiliate_seller/campaign/search', method: 'GET' },
      listOrders: { path: '/affiliate_seller/order/search', method: 'GET' }
    }
  },
  analytics: {
    label: 'Analytics',
    methods: {
      dashboard: { path: '/analytics/dashboard', method: 'GET' },
      stats: { path: '/analytics/stats', method: 'GET' }
    }
  },
  authorization: {
    label: 'Authorization',
    methods: {
      getSellerInfo: { path: '/authorization/seller/info', method: 'GET' }
    }
  },
  product: {
    label: 'Product',
    methods: {
      search: { path: '/product/search', method: 'POST' },
      list: { path: '/product/list', method: 'GET' },
      detail: { path: '/product/detail', method: 'GET' },
      create: { path: '/product/create', method: 'POST', mutating: true },
      update: { path: '/product/update', method: 'POST', mutating: true }
    }
  },
  order: {
    label: 'Order',
    methods: {
      list: { path: '/order/search', method: 'GET' },
      detail: { path: '/order/detail', method: 'GET' },
      ship: { path: '/order/ship', method: 'POST', mutating: true }
    }
  },
  finance: {
    label: 'Finance',
    methods: {
      settlements: { path: '/finance/settlements', method: 'GET' },
      listings: { path: '/finance/listings', method: 'GET' }
    }
  },
  fulfillment: {
    label: 'Fulfillment',
    methods: {
      createPackage: { path: '/fulfillment/package/create', method: 'POST', mutating: true },
      shipPackage: { path: '/fulfillment/package/ship', method: 'POST', mutating: true }
    }
  },
  logistics: {
    label: 'Logistics',
    methods: {
      listShippingProviders: { path: '/logistics/shipping_provider/list', method: 'GET' },
      listWarehouses: { path: '/logistics/warehouse/list', method: 'GET' }
    }
  },
  promotion: {
    label: 'Promotion',
    methods: {
      create: { path: '/promotion/create', method: 'POST', mutating: true },
      list: { path: '/promotion/search', method: 'GET' }
    }
  },
  returnRefund: {
    label: 'Return Refund',
    methods: {
      list: { path: '/return_refund/search', method: 'GET' },
      detail: { path: '/return_refund/detail', method: 'GET' },
      approve: { path: '/return_refund/approve', method: 'POST', mutating: true }
    }
  },
  customerService: {
    label: 'Customer Service',
    methods: {
      listConversations: { path: '/customer_service/conversation/search', method: 'GET' },
      sendMessage: { path: '/customer_service/message/send', method: 'POST', mutating: true }
    }
  },
  supplyChain: {
    label: 'Supply Chain',
    methods: {
      listWarehouses: { path: '/supply_chain/warehouse/list', method: 'GET' },
      listInventoryLedgers: { path: '/supply_chain/inventory_ledger/search', method: 'GET' }
    }
  }
};

function buildResourceApi(groupName, { transport } = {}) {
  if (typeof transport !== 'function') throw new TypeError('transport is required');
  const definition = RESOURCE_GROUPS[groupName];
  const methods = {};
  for (const [name, spec] of Object.entries(definition.methods)) {
    methods[name] = async (params = {}) => {
      if (params == null || typeof params !== 'object' || Array.isArray(params)) throw new TypeError('params must be an object');
      let idempotencyKey = null;
      let payload = params;
      if (spec.mutating) {
        const key = String(params.idempotencyKey ?? '').trim();
        if (!key) throw new Error('idempotencyKey is required');
        idempotencyKey = key;
        payload = { ...params };
        delete payload.idempotencyKey;
      }
      return transport(Object.freeze({ path: spec.path, method: spec.method, params: Object.freeze({ ...payload }), idempotencyKey }));
    };
  }
  return Object.freeze(methods);
}

export const TIKTOK_RESOURCES = Object.freeze(Object.fromEntries(
  Object.entries(RESOURCE_GROUPS).map(([group, definition]) => [group, Object.freeze({
    group,
    label: definition.label,
    methods: Object.freeze(Object.keys(definition.methods)),
    mutatingMethods: Object.freeze(Object.entries(definition.methods).filter(([, spec]) => spec.mutating).map(([name]) => name))
  })]))
);

export function listResourceGroups() {
  return Object.freeze(Object.keys(TIKTOK_RESOURCES));
}

export function getResource(group) {
  const key = String(group ?? '').trim();
  const entry = TIKTOK_RESOURCES[key];
  if (!entry) throw new Error(`unsupported tiktok resource group: ${key || '<empty>'}`);
  return entry;
}

export function createAffiliateCreatorApi(options = {}) {
  return buildResourceApi('affiliateCreator', options);
}

export function createAffiliatePartnerApi(options = {}) {
  return buildResourceApi('affiliatePartner', options);
}

export function createAffiliateSellerApi(options = {}) {
  return buildResourceApi('affiliateSeller', options);
}

export function createAnalyticsApi(options = {}) {
  return buildResourceApi('analytics', options);
}

export function createAuthorizationApi(options = {}) {
  return buildResourceApi('authorization', options);
}

export function createProductApi(options = {}) {
  return buildResourceApi('product', options);
}

export function createOrderApi(options = {}) {
  return buildResourceApi('order', options);
}

export function createFinanceApi(options = {}) {
  return buildResourceApi('finance', options);
}

export function createFulfillmentApi(options = {}) {
  return buildResourceApi('fulfillment', options);
}

export function createLogisticsApi(options = {}) {
  return buildResourceApi('logistics', options);
}

export function createPromotionApi(options = {}) {
  return buildResourceApi('promotion', options);
}

export function createReturnRefundApi(options = {}) {
  return buildResourceApi('returnRefund', options);
}

export function createCustomerServiceApi(options = {}) {
  return buildResourceApi('customerService', options);
}

export function createSupplyChainApi(options = {}) {
  return buildResourceApi('supplyChain', options);
}
