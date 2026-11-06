export type StoryboardSummary = {
  id: string;
  title: string;
  summary: string;
  sceneCount: number;
  totalDurationSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type Scene = {
  id: string;
  storyboardId: string;
  position: number;
  description: string;
  durationSeconds: number;
  hasImage: boolean;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoryboardDetail = {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  scenes: Scene[];
};
