import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { take } from 'rxjs/operators';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { AuthService } from '../../core/services/auth';

@Component({
  selector: 'app-upload-podcast',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './upload-podcast.component.html',
  styleUrls: ['./upload-podcast.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UploadPodcastComponent implements OnInit, OnDestroy {
  artistId: number | null = null;

  categories: any[] = [];
  podcasts: any[] = [];
  episodes: any[] = [];

  selectedPodcast: any = null;
  selectedEpisode: any = null;

  podcastData = {
    title: '',
    categoryId: '',
    description: '',
    isPublic: true
  };

  podcastEdit = {
    title: '',
    categoryId: '',
    description: '',
    visibility: 'PUBLIC' as 'PUBLIC' | 'UNLISTED',
    coverImageUrl: ''
  };

  episodeCreate = {
    title: '',
    durationSeconds: 180,
    releaseDate: new Date().toISOString().slice(0, 10)
  };

  episodeEdit = {
    title: '',
    durationSeconds: 180,
    releaseDate: new Date().toISOString().slice(0, 10)
  };

  newCategory = {
    name: '',
    description: ''
  };

  audioFile: File | null = null;
  imageFile: File | null = null;
  imagePreview: string | null = null;
  editImageFile: File | null = null;
  editImagePreview: string | null = null;
  newEpisodeAudioFile: File | null = null;
  replaceAudioFile: File | null = null;

  isLoading = false;
  isUploading = false;
  isUploadingEditCover = false;
  isSaving = false;
  uploadProgress = 0;
  editCoverUploadProgress = 0;
  replaceAudioProgress = 0;
  error: string | null = null;
  successMessage: string | null = null;
  private readonly episodePreviewSources = new Map<number, string>();
  private readonly episodePreviewLoading = new Set<number>();

  constructor(
    private artistService: ArtistService,
    private stateService: StateService,
    private authService: AuthService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.loadCategories();
    this.bootstrapArtistContext();
  }

  ngOnDestroy(): void {
    for (const source of this.episodePreviewSources.values()) {
      if (source.startsWith('blob:')) {
        URL.revokeObjectURL(source);
      }
    }
    this.episodePreviewSources.clear();
    this.episodePreviewLoading.clear();
  }

  onAudioSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    this.audioFile = file;
    this.cdr.markForCheck();
  }

  onImageSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.error = 'Please select a valid image file.';
      this.cdr.markForCheck();
      return;
    }

    this.imageFile = file;
    this.clearMessages();
    const reader = new FileReader();
    reader.onload = () => {
      this.imagePreview = reader.result as string;
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
  }

  onEditImageSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.error = 'Please select a valid image file.';
      this.cdr.markForCheck();
      return;
    }

    this.editImageFile = file;
    this.clearMessages();
    const reader = new FileReader();
    reader.onload = () => {
      this.editImagePreview = reader.result as string;
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
  }

  onNewEpisodeAudioSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    this.newEpisodeAudioFile = file;
    this.cdr.markForCheck();
  }

  onReplaceAudioSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    this.replaceAudioFile = file;
    this.cdr.markForCheck();
  }

  onSubmit(): void {
    this.createPodcastWithFirstEpisode();
  }

  createPodcastWithFirstEpisode(): void {
    if (!this.podcastData.title.trim() || !this.podcastData.categoryId) {
      this.error = 'Podcast title and category are required.';
      this.cdr.markForCheck();
      return;
    }
    if (!this.imageFile || !this.audioFile) {
      this.error = 'Please select both cover image and episode audio file.';
      this.cdr.markForCheck();
      return;
    }

    this.clearMessages();
    this.isUploading = true;
    this.uploadProgress = 0;
    this.cdr.markForCheck();

    this.artistService.uploadImage(this.imageFile).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.uploadProgress = Math.round((event.loaded / event.total) * 35);
          this.cdr.markForCheck();
          return;
        }

        if (event.type === HttpEventType.Response) {
          const imageUrl = this.artistService.resolveUploadedImageUrl(event);
          if (!imageUrl) {
            this.isUploading = false;
            this.error = 'Cover image upload succeeded, but URL missing.';
            this.cdr.markForCheck();
            return;
          }
          this.executeCreatePodcast(imageUrl, true);
        }
      },
      error: () => {
        this.isUploading = false;
        this.error = 'Cover image upload failed.';
        this.cdr.markForCheck();
      }
    });
  }

  createPodcastWithoutEpisode(): void {
    if (!this.podcastData.title.trim() || !this.podcastData.categoryId) {
      this.error = 'Podcast title and category are required.';
      this.cdr.markForCheck();
      return;
    }
    if (!this.imageFile) {
      this.error = 'Podcast cover image is required.';
      this.cdr.markForCheck();
      return;
    }

    this.clearMessages();
    this.isUploading = true;
    this.uploadProgress = 0;
    this.cdr.markForCheck();

    this.artistService.uploadImage(this.imageFile).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.uploadProgress = Math.round((event.loaded / event.total) * 60);
          this.cdr.markForCheck();
          return;
        }
        if (event.type === HttpEventType.Response) {
          const imageUrl = this.artistService.resolveUploadedImageUrl(event);
          if (!imageUrl) {
            this.isUploading = false;
            this.error = 'Cover image upload succeeded, but URL missing.';
            this.cdr.markForCheck();
            return;
          }
          this.executeCreatePodcast(imageUrl, false);
        }
      },
      error: () => {
        this.isUploading = false;
        this.error = 'Cover image upload failed.';
        this.cdr.markForCheck();
      }
    });
  }

  selectPodcast(podcast: any): void {
    const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? 0);
    if (!podcastId) {
      return;
    }

    this.clearMessages();
    this.isLoading = true;
    this.artistService.getPodcast(podcastId).subscribe({
      next: (podcastDetail) => {
        this.selectedPodcast = podcastDetail;
        this.podcastEdit = {
          title: podcastDetail?.title ?? '',
          categoryId: String(podcastDetail?.categoryId ?? ''),
          description: podcastDetail?.description ?? '',
          visibility: (podcastDetail?.visibility ?? 'PUBLIC') as 'PUBLIC' | 'UNLISTED',
          coverImageUrl: podcastDetail?.coverImageUrl ?? ''
        };
        this.editImagePreview = this.artistService.resolveImageUrl(podcastDetail?.coverImageUrl ?? '');
        this.editImageFile = null;
        this.editCoverUploadProgress = 0;
        this.selectedEpisode = null;
        this.replaceAudioFile = null;
        this.loadEpisodes(podcastId);
      },
      error: () => {
        this.isLoading = false;
        this.error = 'Failed to load podcast details.';
        this.cdr.markForCheck();
      }
    });
  }

  updatePodcast(): void {
    const podcastId = Number(this.selectedPodcast?.podcastId ?? this.selectedPodcast?.id ?? 0);
    if (!podcastId || !this.podcastEdit.title.trim() || !this.podcastEdit.categoryId) {
      return;
    }

    if (this.editImageFile) {
      this.isUploadingEditCover = true;
      this.editCoverUploadProgress = 0;
      this.isSaving = true;
      this.clearMessages();

      this.artistService.uploadImage(this.editImageFile).subscribe({
        next: (event: any) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.editCoverUploadProgress = Math.round((event.loaded / event.total) * 100);
            this.cdr.markForCheck();
            return;
          }

          if (event.type === HttpEventType.Response) {
            const imageUrl = this.artistService.resolveUploadedImageUrl(event);
            if (!imageUrl) {
              this.isSaving = false;
              this.isUploadingEditCover = false;
              this.error = 'Cover image upload succeeded, but URL missing.';
              this.cdr.markForCheck();
              return;
            }

            this.podcastEdit.coverImageUrl = imageUrl;
            this.editImageFile = null;
            this.editImagePreview = this.artistService.resolveImageUrl(imageUrl);
            this.isUploadingEditCover = false;
            this.executePodcastUpdate(podcastId, imageUrl);
          }
        },
        error: () => {
          this.isSaving = false;
          this.isUploadingEditCover = false;
          this.error = 'Failed to upload podcast cover image.';
          this.cdr.markForCheck();
        }
      });
      return;
    }

    this.clearMessages();
    this.isSaving = true;
    this.executePodcastUpdate(podcastId, this.podcastEdit.coverImageUrl);
  }

  deletePodcast(): void {
    const podcastId = Number(this.selectedPodcast?.podcastId ?? this.selectedPodcast?.id ?? 0);
    if (!podcastId) {
      return;
    }

    this.clearMessages();
    this.isSaving = true;
    this.artistService.deletePodcast(podcastId).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Podcast deleted successfully.';
        this.selectedPodcast = null;
        this.selectedEpisode = null;
        this.episodes = [];
        this.loadPodcasts();
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to delete podcast.';
        this.cdr.markForCheck();
      }
    });
  }

  createEpisode(): void {
    const podcastId = Number(this.selectedPodcast?.podcastId ?? this.selectedPodcast?.id ?? 0);
    if (!podcastId || !this.episodeCreate.title.trim() || !this.newEpisodeAudioFile) {
      this.error = 'Episode title and audio file are required.';
      this.cdr.markForCheck();
      return;
    }

    this.clearMessages();
    this.isSaving = true;
    this.uploadProgress = 0;

    this.artistService.createPodcastEpisode(
      podcastId,
      {
        title: this.episodeCreate.title.trim(),
        durationSeconds: Number(this.episodeCreate.durationSeconds || 180),
        releaseDate: this.episodeCreate.releaseDate || new Date().toISOString().slice(0, 10)
      },
      this.newEpisodeAudioFile
    ).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.uploadProgress = Math.round((event.loaded / event.total) * 100);
          this.cdr.markForCheck();
          return;
        }
        if (event.type === HttpEventType.Response) {
          this.isSaving = false;
          this.successMessage = 'Episode created successfully.';
          this.uploadProgress = 100;
          this.episodeCreate = {
            title: '',
            durationSeconds: 180,
            releaseDate: new Date().toISOString().slice(0, 10)
          };
          this.newEpisodeAudioFile = null;
          this.loadEpisodes(podcastId);
        }
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to create episode.';
        this.cdr.markForCheck();
      }
    });
  }

  selectEpisode(episode: any): void {
    const podcastId = Number(this.selectedPodcast?.podcastId ?? this.selectedPodcast?.id ?? 0);
    const episodeId = Number(episode?.episodeId ?? episode?.id ?? 0);
    if (!podcastId || !episodeId) {
      return;
    }

    this.clearMessages();
    this.artistService.getPodcastEpisode(podcastId, episodeId).subscribe({
      next: (episodeDetail) => {
        this.selectedEpisode = episodeDetail;
        this.episodeEdit = {
          title: episodeDetail?.title ?? '',
          durationSeconds: Number(episodeDetail?.durationSeconds ?? 180),
          releaseDate: episodeDetail?.releaseDate ?? new Date().toISOString().slice(0, 10)
        };
        this.replaceAudioFile = null;
        this.replaceAudioProgress = 0;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to load episode details.';
        this.cdr.markForCheck();
      }
    });
  }

  updateEpisode(): void {
    const podcastId = Number(this.selectedPodcast?.podcastId ?? this.selectedPodcast?.id ?? 0);
    const episodeId = Number(this.selectedEpisode?.episodeId ?? this.selectedEpisode?.id ?? 0);
    if (!podcastId || !episodeId || !this.episodeEdit.title.trim()) {
      return;
    }

    this.clearMessages();
    this.isSaving = true;
    this.artistService.updatePodcastEpisode(podcastId, episodeId, {
      title: this.episodeEdit.title.trim(),
      durationSeconds: Number(this.episodeEdit.durationSeconds || 180),
      releaseDate: this.episodeEdit.releaseDate || new Date().toISOString().slice(0, 10)
    }).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Episode updated successfully.';
        this.loadEpisodes(podcastId);
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to update episode.';
        this.cdr.markForCheck();
      }
    });
  }

  deleteEpisode(): void {
    const podcastId = Number(this.selectedPodcast?.podcastId ?? this.selectedPodcast?.id ?? 0);
    const episodeId = Number(this.selectedEpisode?.episodeId ?? this.selectedEpisode?.id ?? 0);
    if (!podcastId || !episodeId) {
      return;
    }

    this.clearMessages();
    this.isSaving = true;
    this.artistService.deletePodcastEpisode(podcastId, episodeId).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Episode deleted successfully.';
        this.selectedEpisode = null;
        this.loadEpisodes(podcastId);
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to delete episode.';
        this.cdr.markForCheck();
      }
    });
  }

  replaceEpisodeAudio(): void {
    const podcastId = Number(this.selectedPodcast?.podcastId ?? this.selectedPodcast?.id ?? 0);
    const episodeId = Number(this.selectedEpisode?.episodeId ?? this.selectedEpisode?.id ?? 0);
    if (!podcastId || !episodeId || !this.replaceAudioFile) {
      this.error = 'Select an episode and replacement audio file.';
      this.cdr.markForCheck();
      return;
    }

    this.clearMessages();
    this.isSaving = true;
    this.replaceAudioProgress = 0;

    this.artistService.replacePodcastEpisodeAudio(podcastId, episodeId, this.replaceAudioFile).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.replaceAudioProgress = Math.round((event.loaded / event.total) * 100);
          this.cdr.markForCheck();
          return;
        }
        if (event.type === HttpEventType.Response) {
          this.isSaving = false;
          this.successMessage = 'Episode audio replaced successfully.';
          this.replaceAudioProgress = 100;
          this.loadEpisodes(podcastId);
        }
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to replace episode audio.';
        this.cdr.markForCheck();
      }
    });
  }

  createCategory(): void {
    if (!this.newCategory.name.trim()) {
      return;
    }

    this.clearMessages();
    this.isSaving = true;
    this.artistService.createPodcastCategory({
      name: this.newCategory.name.trim(),
      description: this.newCategory.description?.trim() ?? ''
    }).subscribe({
      next: (category) => {
        this.isSaving = false;
        this.successMessage = 'Podcast category created successfully.';
        this.newCategory = { name: '', description: '' };
        this.categories = [...this.categories, category];
        this.cdr.markForCheck();
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to create podcast category. This action may require admin role.';
        this.cdr.markForCheck();
      }
    });
  }

  getEpisodeStreamUrl(episode: any): string {
    const episodeId = Number(episode?.episodeId ?? episode?.id ?? 0);
    if (episodeId <= 0) {
      return '';
    }

    const cachedSource = this.episodePreviewSources.get(episodeId);
    if (cachedSource) {
      return cachedSource;
    }

    const directSource = this.buildEpisodeStreamUrl(episode);
    if (!directSource) {
      return '';
    }

    if (!this.requiresAuthenticatedPreviewFetch(directSource)) {
      this.episodePreviewSources.set(episodeId, directSource);
      return directSource;
    }

    if (!this.episodePreviewLoading.has(episodeId)) {
      this.episodePreviewLoading.add(episodeId);
      this.http.get(directSource, { responseType: 'blob' }).subscribe({
        next: (blob) => {
          const previous = this.episodePreviewSources.get(episodeId);
          if (previous && previous.startsWith('blob:')) {
            URL.revokeObjectURL(previous);
          }
          const objectUrl = URL.createObjectURL(blob);
          this.episodePreviewSources.set(episodeId, objectUrl);
          this.episodePreviewLoading.delete(episodeId);
          this.cdr.markForCheck();
        },
        error: () => {
          this.episodePreviewSources.set(episodeId, directSource);
          this.episodePreviewLoading.delete(episodeId);
          this.cdr.markForCheck();
        }
      });
    }

    return '';
  }

  resolveImage(rawUrl: any): string {
    return this.artistService.resolveImageUrl(rawUrl);
  }

  private executePodcastUpdate(podcastId: number, coverImageUrl: string): void {
    this.artistService.updatePodcast(podcastId, {
      categoryId: Number(this.podcastEdit.categoryId),
      title: this.podcastEdit.title.trim(),
      description: this.podcastEdit.description?.trim() ?? '',
      coverImageUrl: coverImageUrl?.trim() ?? '',
      visibility: this.podcastEdit.visibility
    }).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Podcast updated successfully.';
        this.reloadPodcastsAndKeepSelection(podcastId);
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to update podcast.';
        this.cdr.markForCheck();
      }
    });
  }

  private executeCreatePodcast(imageUrl: string, createFirstEpisode: boolean): void {
    this.artistService.createPodcast({
      categoryId: Number(this.podcastData.categoryId),
      title: this.podcastData.title.trim(),
      description: this.podcastData.description?.trim() ?? '',
      coverImageUrl: imageUrl,
      visibility: this.podcastData.isPublic ? 'PUBLIC' : 'UNLISTED'
    }).subscribe({
      next: (podcast) => {
        const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? 0);
        if (!podcastId) {
          this.isUploading = false;
          this.error = 'Podcast created, but podcast id is missing.';
          this.cdr.markForCheck();
          return;
        }

        if (!createFirstEpisode || !this.audioFile) {
          this.isUploading = false;
          this.uploadProgress = 100;
          this.successMessage = 'Podcast created successfully.';
          this.resetPodcastCreateForm();
          this.loadPodcasts();
          this.cdr.markForCheck();
          return;
        }

        this.uploadProgress = 40;
        this.artistService.createPodcastEpisode(
          podcastId,
          {
            title: this.podcastData.title.trim(),
            durationSeconds: 180,
            releaseDate: new Date().toISOString().slice(0, 10)
          },
          this.audioFile
        ).subscribe({
          next: (event: any) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              const progress = Math.round((event.loaded / event.total) * 60);
              this.uploadProgress = Math.min(100, 40 + progress);
              this.cdr.markForCheck();
              return;
            }
            if (event.type === HttpEventType.Response) {
              this.isUploading = false;
              this.uploadProgress = 100;
              this.successMessage = 'Podcast and first episode uploaded successfully!';
              this.resetPodcastCreateForm();
              this.loadPodcasts();
              this.cdr.markForCheck();
            }
          },
          error: () => {
            this.isUploading = false;
            this.error = 'Podcast created, but first episode upload failed.';
            this.loadPodcasts();
            this.cdr.markForCheck();
          }
        });
      },
      error: () => {
        this.isUploading = false;
        this.error = 'Failed to create podcast.';
        this.cdr.markForCheck();
      }
    });
  }

  private bootstrapArtistContext(): void {
    const existingArtistId = this.stateService.artistId;
    if (existingArtistId) {
      this.artistId = existingArtistId;
      this.loadPodcasts();
      return;
    }

    this.authService.currentUser$.pipe(take(1)).subscribe((user) => {
      const username = user?.username ?? '';
      const userId = Number(user?.userId ?? user?.id ?? 0);
      if (!username) {
        this.error = 'Artist identity not found.';
        this.cdr.markForCheck();
        return;
      }

      const cachedArtistId = this.stateService.getArtistIdForUser(userId);
      if (cachedArtistId) {
        this.artistId = cachedArtistId;
        this.stateService.setArtistId(cachedArtistId);
        this.loadPodcasts();
        return;
      }

      this.artistService.findArtistByUsername(username).subscribe({
        next: (response) => {
          const items = response?.content ?? [];
          const artist = items.find((item: any) => String(item?.type ?? '').toUpperCase() === 'ARTIST');
          const artistId = Number(artist?.artistId ?? artist?.contentId ?? 0);
          if (!artistId) {
            this.error = 'Artist profile not found.';
            this.cdr.markForCheck();
            return;
          }

          this.artistId = artistId;
          this.stateService.setArtistId(artistId);
          this.stateService.setArtistIdForUser(userId, artistId);
          this.loadPodcasts();
        },
        error: () => {
          this.error = 'Failed to resolve artist identity.';
          this.cdr.markForCheck();
        }
      });
    });
  }

  private loadCategories(): void {
    this.artistService.getPodcastCategories().subscribe({
      next: (categories) => {
        this.categories = categories ?? [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.categories = [];
        this.cdr.markForCheck();
      }
    });
  }

  private loadPodcasts(): void {
    if (!this.artistId) {
      return;
    }

    this.isLoading = true;
    this.artistService.getArtistPodcasts(this.artistId, 0, 100).subscribe({
      next: (response) => {
        this.podcasts = response?.content ?? [];
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.podcasts = [];
        this.isLoading = false;
        this.error = 'Failed to load your podcasts.';
        this.cdr.markForCheck();
      }
    });
  }

  private loadEpisodes(podcastId: number): void {
    this.artistService.getPodcastEpisodes(podcastId, 0, 100).subscribe({
      next: (response) => {
        this.episodes = response?.content ?? [];
        this.pruneEpisodePreviewSources(this.episodes);
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.episodes = [];
        this.isLoading = false;
        this.error = 'Failed to load podcast episodes.';
        this.cdr.markForCheck();
      }
    });
  }

  private reloadPodcastsAndKeepSelection(podcastId: number): void {
    this.loadPodcasts();
    this.artistService.getPodcast(podcastId).subscribe({
      next: (podcastDetail) => {
        this.selectedPodcast = podcastDetail;
        this.podcastEdit = {
          title: podcastDetail?.title ?? '',
          categoryId: String(podcastDetail?.categoryId ?? ''),
          description: podcastDetail?.description ?? '',
          visibility: (podcastDetail?.visibility ?? 'PUBLIC') as 'PUBLIC' | 'UNLISTED',
          coverImageUrl: podcastDetail?.coverImageUrl ?? ''
        };
        this.editImagePreview = this.artistService.resolveImageUrl(podcastDetail?.coverImageUrl ?? '');
        this.editImageFile = null;
        this.editCoverUploadProgress = 0;
        this.cdr.markForCheck();
      },
      error: () => {
        this.cdr.markForCheck();
      }
    });
  }

  private extractFileName(audioUrl: string): string {
    if (!audioUrl) {
      return '';
    }
    const path = audioUrl.split('?')[0];
    const parts = path.split('/');
    return (parts[parts.length - 1] ?? '').trim();
  }

  private buildEpisodeStreamUrl(episode: any): string {
    const audioUrl = String(episode?.audioUrl ?? '').trim();
    if (!audioUrl) {
      return '';
    }

    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
      return audioUrl;
    }

    const fileName = this.extractFileName(audioUrl);
    if (fileName) {
      return this.artistService.getPodcastStreamUrl(fileName);
    }
    return audioUrl;
  }

  private requiresAuthenticatedPreviewFetch(sourceUrl: string): boolean {
    const value = String(sourceUrl ?? '').trim();
    return value.includes('/api/v1/files/') || value.includes('/files/');
  }

  private pruneEpisodePreviewSources(episodes: any[]): void {
    const validIds = new Set(
      (episodes ?? [])
        .map((episode) => Number(episode?.episodeId ?? episode?.id ?? 0))
        .filter((id) => id > 0)
    );

    for (const [episodeId, source] of this.episodePreviewSources.entries()) {
      if (validIds.has(episodeId)) {
        continue;
      }
      if (source.startsWith('blob:')) {
        URL.revokeObjectURL(source);
      }
      this.episodePreviewSources.delete(episodeId);
      this.episodePreviewLoading.delete(episodeId);
    }
  }

  private resetPodcastCreateForm(): void {
    this.podcastData = {
      title: '',
      categoryId: '',
      description: '',
      isPublic: true
    };
    this.audioFile = null;
    this.imageFile = null;
    this.imagePreview = null;
  }

  private clearMessages(): void {
    this.error = null;
    this.successMessage = null;
  }
}
