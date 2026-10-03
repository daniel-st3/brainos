import {
  assetCandidateSchema,
  type AssetCandidate,
  type CreativePackage,
} from "./schema";
export interface AssetResolver {
  id: string;
  capabilities: {
    search: boolean;
    download: boolean;
    license_metadata: boolean;
  };
  candidates(input: {
    brief: CreativePackage["brief"];
    requirement: CreativePackage["requirements"][number];
  }): Promise<AssetCandidate[]>;
}
/** No implicit network fallback, scraping, downloads or paid providers. */
export class AssetResolverRegistry {
  constructor(private readonly resolvers: readonly AssetResolver[] = []) {}
  get(id: string) {
    const resolver = this.resolvers.find((r) => r.id === id);
    if (!resolver)
      throw Error(
        `ASSET_PROVIDER_NOT_CONFIGURED: ${id}; import or register reviewed candidates manually`,
      );
    return resolver;
  }
  async resolve(id: string, input: Parameters<AssetResolver["candidates"]>[0]) {
    const candidates = await this.get(id).candidates(input);
    return candidates.map((raw) => {
      const candidate = assetCandidateSchema.parse(raw);
      if (candidate.requirement_id !== input.requirement.id)
        throw Error("Resolver returned an unrelated asset requirement");
      return candidate;
    });
  }
}
