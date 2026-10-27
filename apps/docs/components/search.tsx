'use client';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useStaticSearch } from 'fumadocs-core/search/client';
import { basePath } from '@/lib/site';

// The index is exported at build time (app/api/search/route.ts) and searched in the browser,
// so search works on GitHub Pages without a server. Its default URL ignores Next's basePath, and
// the export is a file (no trailing slash) even with trailingSlash on.
export default function DefaultSearchDialog(props: SharedProps) {
  const search = useStaticSearch({ from: `${basePath}/api/search` });
  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
      </SearchDialogContent>
    </SearchDialog>
  );
}
