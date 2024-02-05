import { checkContext } from "feathers-hooks-common";
import type { ManipulateParams, Change } from "./changesById";
import {
  changesByIdBefore,
  changesByIdAfter,
  getOrFindByIdParams,
} from "./changesById";
import transformMustache from "object-replace-mustache";
import sift from "sift";
import copy from "fast-copy";
import _set from "lodash/set.js";

import type { HookContext, Id, Params } from "@feathersjs/feathers";
import type { Promisable } from "type-fest";

interface ViewContext<H extends HookContext = HookContext, T = any> {
  item: Change<T>;
  subscription: Subscription<H, T>;
  subscriptions: Subscription<H, T>[];
  items: Change<T>[];
  context: HookContext;
}

export type ActionOptions<H extends HookContext = HookContext, T = any> = {
  subscription: SubscriptionResolved;
  items: Change<T>[];
  context: H;
  view: Record<string, any>;
};

export type Action<H extends HookContext = HookContext, T = any> = (
  change: Change<T>,
  options: ActionOptions<H, T>,
) => Promisable<void>;

export type HookTriggerOptions<H extends HookContext = HookContext, T = any> =
  | Subscription<H, T>
  | Subscription<H, T>[]
  | ((context: H) => Promisable<Subscription<H, T> | Subscription<H, T>[]>);

export type TransformView<H extends HookContext = HookContext, T = any> =
  | undefined
  | ((
      view: Record<string, any>,
      viewContext: ViewContext<H, T>,
    ) => Promisable<Record<string, any>>)
  | Record<string, any>;

export type Condition<H extends HookContext, T = Record<string, any>> =
  | true
  | T
  | ((item: T, context: H) => Promisable<boolean>);

export interface Subscription<
  H extends HookContext = HookContext,
  T = Record<string, any>,
> {
  /**
   * The name of the subscription
   *
   * Can be used to filter subscriptions
   */
  name?: string;
  service?: string | string[];
  method?: string | string[];
  conditionsData?: Condition<H, T>;
  conditionsResult?: Condition<H, T>;
  conditionsBefore?: Condition<H, T>;
  conditionsParams?: Condition<H, T>;
  view?: TransformView;
  params?: ManipulateParams;
  /** @default true */
  isBlocking?: boolean;
  action: Action<H, T>;
  /** @default false */
  fetchBefore?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: number]: any;
}

export interface SubscriptionResolved extends Subscription {
  dataResolved: boolean | Record<string, any>;
  resultResolved: boolean | Record<string, any>;
  beforeResolved: boolean | Record<string, any>;
  paramsResolved: Params;
  identifier: string;
}

export const trigger = <H extends HookContext, T = any>(
  options: HookTriggerOptions<H, T>,
) => {
  if (!options) {
    throw new Error("You should define subscriptions");
  }

  return async (context: H): Promise<H> => {
    checkContext(
      context,
      null,
      ["create", "update", "patch", "remove"],
      "trigger",
    );

    if (context.type === "before") {
      return await triggerBefore(context, options);
    } else if (context.type === "after") {
      return await triggerAfter(context);
    }
  };
};

const triggerBefore = async <H extends HookContext, T = any>(
  context: H,
  options: HookTriggerOptions<H, T>,
): Promise<H> => {
  let subs = await getSubscriptions(context, options);

  if (!subs?.length) {
    return context;
  }

  if (!Array.isArray(context.data)) {
    const result: SubscriptionResolved[] = [];
    await Promise.all(
      subs.map(async (sub) => {
        if (!sub.action) {
          return;
        }

        if (
          sub.name &&
          context.params.skipTrigger &&
          (context.params.skipTrigger === sub.name ||
            (Array.isArray(context.params.skipTrigger) &&
              context.params.skipTrigger.includes(sub.name)))
        ) {
          return;
        }

        sub.dataResolved =
          typeof sub.conditionsData === "function"
            ? await sub.conditionsData(context.data, context)
            : testCondition(context, context.data, sub.conditionsData);
        if (sub.dataResolved === false) {
          return;
        }

        sub.conditionsParamsResolved =
          typeof sub.conditionsParams === "function"
            ? await sub.conditionsParams(context.data, context)
            : testCondition(context, context.params, sub.conditionsParams);
        if (sub.conditionsParamsResolved === false) {
          return;
        }

        result.push(sub);
      }),
    );
    subs = result;
  }

  if (!subs?.length) {
    return context;
  }

  for (const sub of subs) {
    if (checkConditions(sub)) {
      continue;
    }

    sub.paramsResolved = await getOrFindByIdParams(context, sub.params, {
      deleteParams: ["trigger"],
    });

    sub.identifier = JSON.stringify(sub.paramsResolved);
    if (context.params.changesById?.[sub.identifier]?.itemsBefore) {
      continue;
    }

    const before = await changesByIdBefore(context, {
      skipHooks: false,
      params: () => (sub.params ? sub.paramsResolved : null),
      deleteParams: ["trigger"],
      fetchBefore: sub.fetchBefore || sub.conditionsBefore !== true,
    });

    _set(
      context,
      ["params", "changesById", sub.identifier, "itemsBefore"],
      before,
    );
  }

  setConfig(context, "subscriptions", subs);

  return context;
};

const triggerAfter = async <H extends HookContext>(context: H) => {
  const subs = getConfig(context, "subscriptions");
  if (!subs?.length) {
    return context;
  }

  const now = new Date();

  const promises = [];

  for (const sub of subs) {
    if (
      sub.name &&
      context.params.skipTrigger &&
      (context.params.skipTrigger === sub.name ||
        (Array.isArray(context.params.skipTrigger) &&
          context.params.skipTrigger.includes(sub.name)))
    ) {
      return;
    }

    if (checkConditions(sub)) {
      continue;
    }
    const itemsBefore =
      context.params.changesById?.[sub.identifier]?.itemsBefore;
    let changesById: Record<Id, Change>;
    if (itemsBefore) {
      changesById = await changesByIdAfter(context, itemsBefore, null, {
        name: ["changesById", sub.identifier],
        params: sub.params,
        skipHooks: false,
        deleteParams: ["trigger"],
        fetchBefore: sub.fetchBefore,
      });

      _set(context, ["params", "changesById", sub.identifier], changesById);
    }

    changesById = context.params.changesById?.[sub.identifier];

    if (!changesById) {
      continue;
    }

    const changes = Object.values(changesById);

    for (const change of changes) {
      const { before } = change;
      const { item } = change;

      const changeForSub = change;

      const { conditionsResult, conditionsBefore } = sub;

      let mustacheView: Record<string, unknown> = {
        item,
        before,
        data: context.data,
        id: context.id,
        method: context.method,
        now,
        params: context.params,
        path: context.path,
        service: context.service,
        type: context.type,
        user: context.params?.user,
      };

      if (sub.view) {
        if (typeof sub.view === "function") {
          mustacheView = await sub.view(mustacheView, {
            item: changeForSub,
            items: changes,
            subscription: sub,
            subscriptions: subs,
            context,
          });
        } else {
          mustacheView = Object.assign(mustacheView, sub.view);
        }
      }

      sub.resultResolved =
        typeof conditionsResult === "function"
          ? await conditionsResult({ item, before }, context)
          : testCondition(mustacheView, item, conditionsResult);
      if (!sub.resultResolved) {
        continue;
      }

      sub.beforeResolved =
        typeof conditionsBefore === "function"
          ? await conditionsBefore({ item, before }, context)
          : testCondition(mustacheView, before, conditionsBefore);
      if (!sub.beforeResolved) {
        continue;
      }

      const _action = sub.action;

      const promise = _action(changeForSub, {
        subscription: sub,
        items: changes,
        context,
        view: mustacheView,
      });

      if (sub.isBlocking) {
        promises.push(promise);
      }
    }
  }

  await Promise.all(promises);

  return context;
};

function setConfig(
  context: HookContext,
  key: "subscriptions",
  val: SubscriptionResolved[],
): void;
function setConfig(context: HookContext, key: string, val: unknown): void {
  context.params.trigger = context.params.trigger || {};
  context.params.trigger[key] = val;
}

function getConfig(
  context: HookContext,
  key: "subscriptions",
): undefined | SubscriptionResolved[];
function getConfig(
  context: HookContext,
  key: string,
): undefined | SubscriptionResolved[] {
  return context.params.trigger?.[key];
}

function checkConditions(sub: Subscription): boolean {
  return !sub.conditionsBefore && !sub.conditionsData && !sub.conditionsResult;
}

const defaultSubscription: Required<SubscriptionResolved> = {
  name: undefined,
  action: undefined,
  conditionsBefore: true,
  conditionsData: true,
  conditionsParams: true,
  conditionsResult: true,
  dataResolved: undefined,
  beforeResolved: undefined,
  resultResolved: undefined,
  isBlocking: true,
  method: undefined,
  params: undefined,
  service: undefined,
  view: undefined,
  paramsResolved: undefined,
  identifier: null,
  fetchBefore: false,
};

const getSubscriptions = async <H extends HookContext, T = any>(
  context: H,
  options: HookTriggerOptions<H, T>,
): Promise<undefined | SubscriptionResolved[]> => {
  const _subscriptions =
    typeof options === "function" ? await options(context) : options;

  if (!_subscriptions) {
    return;
  }

  const subscriptions = Array.isArray(_subscriptions)
    ? _subscriptions
    : [_subscriptions];

  const subscriptionsResolved = subscriptions.map((x) =>
    Object.assign({}, defaultSubscription, x),
  );

  const { path, method } = context;

  return subscriptionsResolved.filter((sub) => {
    if (
      (typeof sub.service === "string" && sub.service !== path) ||
      (Array.isArray(sub.service) && !sub.service.includes(path))
    ) {
      return false;
    }
    if (
      (typeof sub.method === "string" && sub.method !== method) ||
      (Array.isArray(sub.method) && !sub.method.includes(method))
    ) {
      return false;
    }
    return true;
  });
};

const testCondition = (
  mustacheView: Record<any, any>,
  item: unknown,
  conditions: true | Record<string, any>,
): boolean | Record<string, unknown> => {
  if (conditions === true) {
    return true;
  }

  conditions = copy(conditions);
  const transformedConditions = transformMustache(conditions, mustacheView);
  return sift(transformedConditions)(item) ? transformedConditions : false;
};
